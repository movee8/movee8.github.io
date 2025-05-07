## 1 为什么需要HugePage

linux内存管理系统中的`HugePage`一般叫做`大页`或`巨页`，它是相对于标准page（页）来说的。我们知道，linux对物理内存的管理是以page为单位进行的。虽然，应用程序申请内存时能够每次申请一个或多个字节的内存，但是在linux的底层物理内存管理系统却每次只能申请或释放一个或多个page大小的内存。page的大小固定为`4KB`，而HugePage的大小可以为`2MB`或`1GB`。那么linux系统既然以page为单位管理物理内存，为什么又要引入HugePage，让内存管理更复杂呢？这又要从linux系统的虚拟地址与物理地址的转换说起。

我们知道，linux进程使用的地址为虚拟地址，当它需要访问物理内存中的数据时，需要将虚拟地址转换为数据在内存中的物理地址。进程访问数据过程如下图所示：

![mmu](/images/perf-program/mmu.png)

1.  CPU尝试从L1 Cache（访问指令数据则是L1 I-Cache，访问程序操作数据则是L1 D-Cache）访问数据。如果数据没有缓存在L1 Cache中，则需要先将虚拟地址转换为物理地址
2.  CPU芯片中有一个专门的硬件`MMU`（`Memory Management Unit`）来专门负责将虚拟地址转换为物理地址。这个MMU会负责整个芯片所有CPU逻辑核心（进程）的地址转换工作。它会先查询`TLB`（`Translation Lookaside Buffer`）缓存中是否存在地址映射关系；如果不存在，则继续通过`TWU`（`Table Walk Unit`）组件查询物理内存中的页表尝试获取对应的物理。注意，TLB是所有进程（CPU）共用的，而每个进程都拥有一个自己独立的页表。
3.  如果能够获取到对应的物理地址，则使用物理地址继续尝试从L2 Cache和L3 Cache中访问数据。如果缓存中没有数据，则进一步访问物理内存。
4.  如果没有获取到映射的物理地址，则可能是对应的物理内存还没有分配，或者物理内存已经`swap out`到外部存储（硬盘、SSD）中了。这时MMU会触发`运行当前进程的CPU发起一个缺页中断`（`page fault`）。缺页中断响应程序会为进程实际分配物理内存，并修改页表，建立虚拟地址到物理地址的映射关系。如果数据swap out出去了，还会将数据`swap in`进来。

MMU查询页表的过程如下所示，标准页表由四级页表组成。

![pagetable-4kb](/images/perf-program/pagetable-4kb.png)

从图中可知，在查询页表时，MMU只使用了虚拟地址的低48bit，高16bit是没有使用的。因为48bit地址可以表示`256T`的地址范围，目前这对单个进程来说已经足够了。MMU查询页表的步骤为：

1.  以当前进程的CPU的`CR3`寄存器的值作为基地址，加上虚拟地址的\[47,39]比特位（共9bit）表示的偏移值，查询`PGD`（`Page Global Directory`）表，得到`PUD`（`Page Upper Directory`）表的地址。
2.  PUD表地址，加上虚拟地址的\[38,30]比特位（共9bit）表示的偏移值，查询PUD表，得到`PMD`（`Page Middle Directory`）表的地址。
3.  PMD表地址，加上虚拟地址的\[29,21]比特位（共9bit）表示的偏移值，查询PMD表，得到`PTE`（`Page Table Entry`）表的地址
4.  PTE表地址，加上虚拟地址的\[20,12]比特位（共9bit）表示的偏移值，查询PTE表，得到`page`的地址
5.  page地址，加上虚拟地址的\[11,0]比特位（共12bit）表示的偏移值，得到数据最终的物理内存地址

> 查询PGD、PUD、PMD、PTE页表时，都只使用了虚拟地址的9bit的地址位。这是故意为之的，因为9bit地址刚好寻址512\*64bit=4KB的地址空间，刚好是一个标准页的大小。

> CR3寄存器又叫做页目录基址寄存器（`PDBR`，`Page Directory Base Register`），存储的是当前进程的页表基地址。当CPU进行进程上下文切换时，CPU会将切入进程的PGD表的基地值加载到CR3寄存器。进程的PGD表其实刚好是一个标准页

从上面的分析可知：

1.  只要数据不在L1 Cache中，就需要进行虚拟地址到物理地址的转换。所以这个转换操作是非常非常频繁的，它的性能对系统的性能至关重要。正因为如此，CPU芯片专门设计了一个硬件组件MMU来执行这个操作

2.  地址转换的性能主要处决于TLB缓存的命中率和页表的查询效率，尤其是TLB的命中率。由于页表存储在物理内存中，如果TLB没有命中，那么需要查询物理内存4次才能得到数据的物理地址，最坏情况需要访问物理内存5次才能访问到数据（数据不在L2/L3 Cache中）。

3.  增加页的大小可以极大地提升TLB缓存的命中率

    TLB缓存的查询性能非常高，比查询L2、L3 Cache还高很多，甚至略高于L1 Cache，与寄存器差不多了。问题是为了保证这么高的性能，TLB的容量往往相对也很小，而且还要被所有进程共同使用。我手边一台拥有96个逻辑核心、768GB物理内存的服务器，它的CPU芯片的TLB大小如下：

    ```bash
    # cpuid -1 | grep -i tlb
    Disclaimer: cpuid may not support decoding of all cpuid registers.
       cache and TLB information (2):
          0x63: data TLB: 1G pages, 4-way, 4 entries
          0x03: data TLB: 4K pages, 4-way, 64 entries
          0x76: instruction TLB: 2M/4M pages, fully, 8 entries
          0xb5: instruction TLB: 4K, 8-way, 64 entries
          0xc3: L2 TLB: 4K/2M pages, 6-way, 1536 entries
    ```

    可见，这颗CPU芯片的L2 TLB只有1536条表项，标准page的L1 TLB只有64条表项，HugePage的L1 Cache更是只有区区的几条表项。假设一个进程使用内存40GB，那么最少需要1000万个标准page，缓存条目数与page数比值为0.01%。如果使用2MB大小的page，那么只需要2万个page，缓存条目数与page数比值提升到5%。如果使用1GB大小的page，那么只需要40个page；从而极大地提升了TLB缓存命中率。

4.  增加页的大小可以提升页表的查询效率

    上面提到，标准页表需要查询4次。如果page大小为2MB，则查询过程为：

    ![pagetable-2mb](/images/perf-program/pagetable-2mb.png)

    可见，只需要查询3次。如果page大小为1GB，则只需要查询2次。由此也可以看出，我们之所以一般选择HugePage大小为2MB和1GB，其中一个原因是它刚好可以减少1到2次的页表查询。

5.  增加页的大小可以增加缺页中断的页面分配效率

    使用HugePage后，缺页中断分配的page数量也大幅降低了，同时也就减少了内存分配时间

由此可见，通过使用HugePage，对于需要使用大量内存的内存密集型应用，往往一次需要申请大块内存，常见的如数据库、消息中间件、网络数据分析或NFV（例如使用DPDK），可以大幅提升TLB命中率、页表查询性能，从而大幅提升应用的性能

## 2 如何在应用中使用HugePage

### 2.1 查看系统是否支持HugePage

我们可以查看内核的编译选项，如果下面命令显示`CONFIG_HUGETLBFS`和`CONFIG_HUGETLB_PAGE`两个选项值是`y`表示支持。事实上，由于linux 2.6版本内核就开始支持HugePage了，现代linux内核版本一般都是默认支持的。

```bash
# grep -i hugetlb /boot/config-`uname -r`
CONFIG_CGROUP_HUGETLB=y
CONFIG_ARCH_WANT_GENERAL_HUGETLB=y
CONFIG_HUGETLBFS=y
CONFIG_HUGETLB_PAGE=y
```

### 2.2 查看系统支持的HugePage大小

我们可以通过下面的命令进行查看，如果CPU的flags包含`pse`，则表示支持2MB的HugePage；如果flags包含`pdpe1gb`，则表示支持1GB的HugePage。2MB HugePage一般是默认支持的。

```bash
# lscpu | grep -i pse
# lscpu | grep -i pdpe1gb
```

也可以通过`sysfs`进行查看。

```bash
# ls /sys/devices/system/node/node0/hugepages/
hugepages-1048576kB  hugepages-2048kB
```

### 2.3 为系统分配预留HugePage

与标准page不同，并不是系统支持HugePage，我们就可以直接使用了。在使用前，我们需要让系统专门预留相应数量的HugePage数量。

例如我们查看一下系统的HugePage统计数据，可见当前该系统没有可用的HugePage

```bash
$ cat /proc/meminfo | grep Huge
HugePages_Total:       0
HugePages_Free:        0
HugePages_Rsvd:        0
HugePages_Surp:        0
Hugepagesize:       2048 kB
Hugetlb:               0 kB
```

> 解释：
>
> HugePages\_Total：表示系统预留的总的HugePage数量，这是我们能使用的最大HugePage数量
>
> HugePages\_Free：表示空闲的HugePage数量，这是我们当前能申请使用的HugePage数量
>
> HugePages\_Rsvd：表示系统保留的HugePage数量。这些page已经被分配（应用已分配虚拟地址），但是还没有映射到物理内存
> HugePages\_Surp：系统允许超额申请一定数量的HugePage，这就是超额申请的数量。允许超额的最大值由`/proc/sys/vm/nr_overcommit_hugepages`确定
>
> Hugepagesize：系统默认的HugePage大小，这里是默认的2MB
>
> Hugetlb: 分配的HugePage的总字节数

注意，我们在查看meminfo时，可能还看到如下的统计项：

```bash
# cat /proc/meminfo | grep -i huge
AnonHugePages:     12288 kB
ShmemHugePages:        0 kB
FileHugePages:         0 kB
HugePages_Total:       0
```

这里出现了AnonHugePages、ShmemHugePages、FileHugePages三个统计项，名字看上去也是HugePage的统计项。但是它们并不是我们这里讨论的HugePage，而是`透明大页`（`THP`，`Transparent Huge Pages`）。THP底层的分配还是基于4KB标准page的，只是操作系统为了提高TLB命中率和页表查询性能，自动将地址连续的标准page聚合成HugePage。应用程序对这些聚合操作是完全没有感知的，在它看来还是在使用4KB标准page，所以叫透明大页。

我们有多种方式分配HugePage

#### 2.3.1 通过sysfs文件系统接口进行分配

最简单直接的方式是执行下面的命令分配10240个2MB的HugePage，内存量共20GB

```bash
# 分配前先看一下内存的使用情况
# free -h
              total        used        free      shared  buff/cache   available
Mem:           754G        2.9G        731G        3.9G         20G        722G
Swap:            0B          0B          0B

# 分配10240个2MB的HugePage
# echo 10240 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages

# 再次查看内存使用情况，虽然我们只申请分配了HugePage，还没有使用，但是free命令已经把这部分内存记为used
# free -h
              total        used        free      shared  buff/cache   available
Mem:           754G         22G        711G        3.9G         20G        702G
Swap:            0B          0B          0B

$ cat /proc/meminfo | grep Huge
HugePages_Total:       10240
HugePages_Free:        10240
HugePages_Rsvd:        0
HugePages_Surp:        0
Hugepagesize:       2048 kB
Hugetlb:        20971520 kB
```

通过`free`命令查看HugePage分配前后的内存变化，可以发现，虽然我们只申请分配了HugePage，还没有使用，但是free命令已经把这部分内存记为used了，说明应用程序不能通过常规的方式使用这部分内存了

现代的内存系统一般是`NUMA`（`Non-Uniform Memory Access`），上述的分配方式会在多个node中平均分配，如果想为node分配不一样，可以对node进行单独分配

```bash
# 指定numa节点的hugepage数量
$ echo 2560 > /sys/devices/system/node/node0/hugepages/hugepages-2048kB/nr_hugepages
$ echo 7680 > /sys/devices/system/node/node1/hugepages/hugepages-2048kB/nr_hugepages
```

如果想持久化HugePage配置，在系统重启后依然生效，可以将配置写入`/etc/sysctl.conf`文件

```bash
# vim /etc/sysctl.conf
vm.nr_hugepages = 10240

# sysctl -p
```

#### 2.3.2 通过修改系统启动参数进行分配

可以通过修改启动参数，系统启动时分配HugePage

如果是比较早的grub引导系统，可以在`/boot/grub/grub.conf`配置文件中添加，如下所示：

```text
kernel /boot/vmlinuz-xxx root=UUID=fb7646c1-f982-4dda-9b48-8d81393a83ac ro biosdevname=0 fsck.mode=force console=tty0 crashkernel=384M console=ttyS0,115200 iommu=pt nokaslr net.ifnames=0 fsck.repair=yes hugepagesz=2M hugepages=10240
```

如果是grub2引导系统，可以在`/etc/default/grub`文件中添加

```bash
# cat /etc/default/grub
# Set by curtin fast-path installer.
GRUB_TIMEOUT=5
GRUB_DEFAULT=0
GRUB_HIDDEN_TIMEOUT=0
GRUB_TERMINAL_OUTPUT="console"
GRUB_DISABLE_RECOVERY="true"
GRUB_DISTRIBUTOR="CentOS Linux release 7.6 (Final)"
GRUB_CMDLINE_LINUX=" biosdevname=0 fsck.mode=force console=tty0 crashkernel=384M console=ttyS0,115200 iommu=pt nokaslr net.ifnames=0 fsck.repair=yes hugepagesz=2M hugepages=10240"
```

如果想系统同时支持多个大小的HugePages，可以如下配置

```text
default_hugepagesz=2M hugepages=10240 hugepagesz=1G hugepages=10240
```

如果想NUMA不同的node配置不同的HugePage数量，可以如下配置

```text
hugepagesz=2M hugepages=0:2560,1:7680
```

### 2.4 挂载hugetlbfs文件系统

使用HugePage前，还需要挂载文件系统，如下所示

```bash
# cat /proc/filesystems | grep huge
nodev   hugetlbfs

$ mkdir /mnt/huge
# nodev表示不允许在这个文件系统上创建设备文件
$ mount -t hugetlbfs nodev /mnt/huge
```

持久化配置，重启后依然生效

```bash
$ vim /etc/fstab
nodev /mnt/huge hugetlbfs defaults 0 0

# 1GB大小的hugepage，需要添加pagesize参数
$ vim /etc/fstab
nodev /mnt/huge_1GB hugetlbfs pagesize=1GB 0 0
```

### 2.4 在应用程序中申请和使用HugePage

经过漫长的准备工作，我们终于可以编写代码使用HugePage了，实例代码如下：

```rust
use libc;
use std::ptr;

fn main() {
    unsafe {
        // 定义HugePage的大小，通常是2MB
        const HUGEPAGE_SIZE: usize = 2 * 1024 * 1024;

        // 使用mmap申请HugePage内存
        let addr = libc::mmap(
            ptr::null_mut(), // 让内核选择地址
            HUGEPAGE_SIZE,   // 大小
            libc::PROT_READ | libc::PROT_WRITE, // 读写权限
            libc::MAP_PRIVATE | libc::MAP_ANONYMOUS | libc::MAP_HUGETLB, // 匿名映射和HugePage标志
            -1, // 文件描述符
            0,  // 偏移
        );

        if addr == libc::MAP_FAILED {
            eprintln!("Failed to allocate huge page memory");
            return;
        }

        println!("HugePage memory allocated at: {:?}", addr);

        // 使用hugepage内存
        let slice: &mut [u8] = std::slice::from_raw_parts_mut(addr as *mut u8, HUGEPAGE_SIZE);
        slice[0] = 42; // 示例操作

        println!("First byte of HugePage memory: {}", slice[0]);

        // 添加30秒延时
        println!("Waiting for 30 seconds before releasing memory...");
        std::thread::sleep(std::time::Duration::from_secs(30));

        // 释放HugePage内存
        if libc::munmap(addr, HUGEPAGE_SIZE) != 0 {
            eprintln!("Failed to unmap huge page memory");
        } else {
            println!("HugePage memory successfully unmapped");
        }
    }
}
```

执行上述代码

```bash
# cargo run
HugePage memory allocated at: 0x747e83c00000
First byte of HugePage memory: 42
Waiting for 30 seconds before releasing memory...
HugePage memory successfully unmapped
```

另外新开一个窗口，程序运行中查看HugePages\_Free页数，发现少了一个HugePage页

```bash
# cat /proc/meminfo | grep -i huge
HugePages_Total:     10240
HugePages_Free:      10239
HugePages_Rsvd:        0
HugePages_Surp:        0
Hugepagesize:       2048 kB
Hugetlb:        20971520 kB
```

程序运行结束后，再次查看HugePages\_Free页数，发现释放HugePage后，free的HugePage数又恢复到了分配值

```bash
root@ecs01:~# cat /proc/meminfo | grep -i huge
HugePages_Total:     10240
HugePages_Free:      10240
HugePages_Rsvd:        0
HugePages_Surp:        0
Hugepagesize:       2048 kB
Hugetlb:        20971520 kB
```
