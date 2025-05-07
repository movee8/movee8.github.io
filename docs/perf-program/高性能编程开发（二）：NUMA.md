## 1 什么是NUMA

`NUMA`（`Non-Uniform Memory Access`），即`非一致性内存访问`，是一种内存访问架构。在这种架构中，不同CPU访问同一块内存的速度不同。NUMA架构的名字是从内存访问角度来命名的，从CPU角度来看，这种架构往往也叫做`AMP`（`Asymmetric Multi-Processing`，`非对称多处理`）。一看NUMA和AMP这名字，就应该还存在一个叫做UMA（`Uniform Memory Access`，即`一致性内存访问`）和`SMP`（`Symmetric Multi-Processing`，即`对称多处理`）的架构。在UMA和SMP架构中，CPU访问内存方式如下图所示：

![uma-arch](/images/perf-program/uma-arch.png)

在这种架构中，所有CPU通过同一个总线来访问所有的内存，它的好处是所有的CPU和内存都是对等的，简化了进程和数据的分配和调度，因为你把进程调度到任何CPU，把数据存入任何地址的内存，在不考虑Cache影响的情况下，效果都是一样。但是由于共用同一条总线，当多个CPU同时访问内存时，就会存在总线锁争用的现象。一个CPU访问内存时，其他的CPU都必须等待CPU释放总线，然后重新争夺总线使用权。当CPU数量较少时，对系统性能影响还较小。随着CPU数量的增加，这种架构就逐渐成为制约系统性能提升的瓶颈。有实验表明，SMP架构比较适用的CPU数量是2～4个。而现代服务器的CPU数量往往都大于这个数，所以大家现在使用的服务器基本都见不到SMP架构的了。

既然是共用总线制约了系统性能，那么自然就可以想到不同的内存使用自己独立的访问总线，这就是NUMA架构。原理图如下所示：

![numa-arch](/images/perf-program/numa-arch.png)

如图所示，NUMA架构将CPU和内存划分到不同的NUMA node中，CPU访问自己所属node内的内存时，通过内部的内存总线就可以直接访问。但是当访问其他node内的内存时，则需要通过node间的互联总线（如`QPI`总线，`Quick Path Interconnect`）连接到目标node内的内存总线，才能访问到。这样一来，一方面不同node的内存可以并行访问，提高了系统内存的总访问带宽。另一方面，cpu访问自己node内的内存比跨node访问内存时的性能要高。在NUMA架构中，表示cpu访问内存的性能差异有一个专门的术语：`distance`。distance越大，表示cpu距离内存距离越远，访问成本越高，性能越低，延时越大。

例如，我身边的一台服务器的NUMA信息如下：

```bash
$ numactl -H
available: 2 nodes (0-1)
node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71
node 0 size: 385224 MB
node 0 free: 371343 MB
node 1 cpus: 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95
node 1 size: 387055 MB
node 1 free: 376907 MB
node distances:
node   0   1 
  0:  10  21 
  1:  21  10
```

可见，这台服务器有2个NUMA node，每个node有48个cpu。node 0的总可用内存为`385224 MB`，当前剩余可用内存为`371343 MB`。尤其需要注意的是，跨node内存访问（`远程访问`）的性能（`distance 10`）只有同node内存访问（`本地访问`）性能（`distance 21`）的一半

## 2 NUMA内存分布

NUMA架构中，不同的cpu和内存不再是对等的了。在分析内存使用情况时，有的时候不仅仅期望通过`free`、`top`、`cat /proc/meminfo`等命令查看内存总的使用情况，还期望知道每个node的内存使用情况，比如上面通过`numactl -H`（或`numactl --hardware`）命令查看每个node的`total memory`和`free memory`。

### 2.1 查看内存的zone分布

```bash
$ cat /proc/zoneinfo | egrep 'zone |free '
Node 0, zone      DMA
  pages free     2816
Node 0, zone    DMA32
  pages free     306563
Node 0, zone   Normal
  pages free     94748059
Node 0, zone  Movable
  pages free     0
Node 0, zone   Device
  pages free     0
Node 1, zone      DMA
  pages free     0
Node 1, zone    DMA32
  pages free     0
Node 1, zone   Normal
  pages free     96484058
Node 1, zone  Movable
  pages free     0
Node 1, zone   Device
  pages free     0
```

可见，这台服务器的DMA和DMA32区域分布在node 0上，外部设备通过DMA读写系统内存数据都发生在node 0的内存中

### 2.2 查看NUMA内存使用情况

下面这个命令与查看`/proc/meminfo`的内容差不多，不过同时列出了每个node的内存使用情况

```bash
# numastat -m

Per-node system memory usage (in MBs):
                          Node 0          Node 1           Total
                 --------------- --------------- ---------------
MemTotal               385224.75       387055.24       772279.99
MemFree                371649.29       376963.43       748612.72
MemUsed                 13575.46        10091.81        23667.27
Active                   3304.15         1992.89         5297.04
Inactive                 8333.79         6444.62        14778.41
Active(anon)             2191.73          483.41         2675.15
Inactive(anon)           1557.78          804.89         2362.68
Active(file)             1112.42         1509.48         2621.89
Inactive(file)           6776.00         5639.73        12415.73
Unevictable                 0.00            0.00            0.00
Mlocked                     0.00            0.00            0.00
Dirty                       0.09            0.18            0.27
Writeback                   0.00            0.00            0.00
FilePages               11159.27         7714.25        18873.52
Mapped                    139.16           85.99          225.15
AnonPages                 478.20          715.25         1193.45
Shmem                    3273.07          774.15         4047.22
KernelStack                16.84           14.00           30.84
PageTables                 13.78           11.13           24.91
NFS_Unstable                0.00            0.00            0.00
Bounce                      0.00            0.00            0.00
WritebackTmp                0.00            0.00            0.00
Slab                      857.81          991.91         1849.72
SReclaimable              492.35          694.43         1186.78
SUnreclaim                365.46          297.48          662.94
AnonHugePages               0.00           10.00           10.00
HugePages_Total             0.00            0.00            0.00
HugePages_Free              0.00            0.00            0.00
HugePages_Surp              0.00            0.00            0.00
```

### 2.3 查看NUMA内存分配统计信息

```bash
# numastat
                           node0           node1
numa_hit           4534585417981   4442713535388
numa_miss           170769802756    568935593301
numa_foreign        568935593301    170769802756
interleave_hit             28257           28625
local_node         4535807010365   4447129367600
other_node          169548210372    564519761089
```

字段的含义如下：

> numa\_hit: 根据内存分配策略，应该分配在本node，实际也分配在本node的page数
>
> numa\_miss: 根据内存分配策略，应该分配在本node，但是实际没有分配在本node，而是分配到了其他node的page数。
>
> numa\_foreign: 。根据内存分配策略，应该分配到其他node，但是实际分配在本node的page数。在只有2个node的系统中，一个node的numa\_miss应该等于另一个node的numa\_foreign值
>
> interleave\_hit: 通过交替内存分配策略分配内存，然后在本node分配的page数
>
> local\_node: 当进程运行在本node，系统为它分配内存时，内存分配在本node的page数
>
> other\_node: 当进程运行在其它node，系统为它分配内存时，内存分配在本node的page数

我们总是期望`numa_hit`和`local_node`的值越大越好，`numa_miss`和`numa_foreign`的值最好为零。

如果期望展示的内存单位不是page数，而是MB，可以使用`numastat -n`命令

### 2.4 查看指定进程的NUMA内存使用情况

```bash
# numastat -p 84042

Per-node process memory usage (in MBs) for PID 84042 (webfoot-agent)
                           Node 0          Node 1           Total
                  --------------- --------------- ---------------
Huge                         0.00            0.00            0.00
Heap                         0.00            0.30            0.30
Stack                        0.00            0.02            0.02
Private                      1.89            2.61            4.51
----------------  --------------- --------------- ---------------
Total                        1.89            2.93            4.83
```

### 2.5 查看指定进程的NUMA内存详细映射信息

```bash
cat /proc/84042/numa_maps
00400000 default file=/usr/bin/bash mapped=110 mapmax=24 N0=110 kernelpagesize_kB=4
006d5000 default file=/usr/bin/bash anon=5 dirty=5 mapmax=4 active=0 N0=5 kernelpagesize_kB=4
006de000 default anon=5 dirty=5 mapmax=2 active=0 N0=5 kernelpagesize_kB=4
01fea000 default heap anon=112 dirty=112 mapmax=4 active=0 N0=111 N1=1 kernelpagesize_kB=4
```

上面的default表示使用默认的内存分配策略，kernelpagesize\_kB表示page的大小，其他的数字均表示相应的page数。例如：`heap anon=112 dirty=112 mapmax=4 active=0 N0=111 N1=1`表示该进程的堆使用112个page，有111个page分配在node 0上，1个page分配在node 1上

## 3 NUMA亲和性

从上面的分析可知，进程进行NUMA远程访问和本地访问的性能是不一样的，相差可以达到2倍以上。自然地，从性能上考虑，我们期望进程访问内存时都是本地访问方式。但是，操作系统在调度进程时，可能将进程从一个NUMA node调度到另一个node，这样即使调度前进程分配和访问内存都是本地模式，调度后就变成远程模式了。这种进程运行在哪个NUMA node的CPU上，分配和访问的内存位置（内存所属node）与进程运行的node的相对关系，就称为`进程的NUMA CPU亲和性和内存亲和性`。我们可以通过`numactl`命令来控制和管理进程的NUMA亲和性。

numactl主要参数介绍：

CPU绑定相关

```bash
--preferred= | -p <node>
     进程优先运行在指定的NUMA node上，指定node的cpu均繁忙时，就调度到其他node上
--physcpubind= | -C <cpus>
     让进程运行在指定的cpu上，参数cpus的值可以是cpu的列表、范围或all，例如：1,3,5,10-12
--cpunodebind= | -N <nodes>
     让进程运行在指定的NUMA node上，参数nodes的值可以是node的列表、范围或all，例如：0,1,3-4
```

内存绑定相关

```bash
--interleave= | -i <nodes>
     在指定的NUMA node中以交替模式分配内存，参数nodes的值可以是node的列表、范围或all。例如系统有0,1两个node，参数nodes值为all，那么进程申请分配的内存  node顺序为：0,1,0,1......
--membind= | -m <nodes>
     在指定的NUMA node中分配内存，参数nodes的值可以是node的列表、范围或all
--localalloc | -l
     在本地NUMA node中分配内存，进程运行在哪个node的cpu上，就从哪个node中分配内存
```

举个例子，我有一个叫做hello-numa的程序，它会通过`numactl --show`命令打印当前进程的NUMA policy，hello-numa的内容如下：

```bash
#! /bin/sh

numactl --show
echo "===="
while true
do
    sleep 10
    echo hello
done
```

现在我期望这个程序运行在node 1的cpu上，且在node 1上分配内存，那么我可以这样启动程序:

```bash
$ numactl --cpunodebind=1 --membind=1 ./hello-numa
policy: bind
preferred node: 1
physcpubind: 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 
cpubind: 1 
nodebind: 1 
membind: 1
==== 
hello
```

这样启动hello-numa程序后，hello-numa进程，它创建的所有子进程和线程，都将运行在node 1的cpu上。同时需要注意的是，如果期望通过numactl命令指定程序的亲和性，那么需要像上面那样在启动程序时指定。numactl不支持在程序启动后通过进程ID再指定程序的NUMA亲和性。

查看一下上面进程的内存分配情况，可见进程的堆和栈内存都是从node 1中分配的

```bash
# ps -ef | grep hello
root      2714  7728  0 11:57 pts/0    00:00:00 /bin/sh ./hello-numa
# numastat -p 2714
Per-node process memory usage (in MBs) for PID 2714 (hello-numa)
                           Node 0          Node 1           Total
                  --------------- --------------- ---------------
Huge                         0.00            0.00            0.00
Heap                         0.00            0.32            0.32
Stack                        0.00            0.02            0.02
Private                      4.45            0.44            4.89
----------------  --------------- --------------- ---------------
Total                        4.45            0.77            5.22
```

在NUMA系统中，其实不仅仅cpu和内存存在NUMA亲和性，其他的外部设备也存在NUMA亲和性。例如DMA zone的内存一般分配在系统的node 0上，那么通过DMA传输数据的网卡等外部设备，会通过node 0上的内存进行数据交换，处理这些DMA数据的进程如果也运行在相应的node上，性能相应也会高点。numactl命令也可以通过这些外部设备的亲和性来指定进程的NUMA绑定policy。命令参数格式如下：

```bash
netdev:DEV                 The node connected to network device DEV.
file:PATH                  The node the block device of PATH.
ip:HOST                    The node of the network device of HOST
block:PATH                 The node of block device PATH
pci:[seg:]bus:dev[:func]   The node of a PCI device.
```

例如，我的机器上有一个xgbe0网口，我可以这样启动hello-numa

```bash
# numactl --cpunodebind=netdev:xgbe0 --membind=netdev:xgbe0 ./hello-numa
```

我的机器上有一条下面的路由

```bash
# ip route
10.0.0.0/8 via 10.46.83.65 dev xgbe0 
```

那么我也可以这样启动hello-numa

```bash
# numactl --cpunodebind=ip:10.0.0.0 --membind=ip:10.0.0.0 ./hello-numa
```

上面两种启动hello-numa程序的方式均等效于：

```bash
# numactl --cpunodebind=0 --membind=0 ./hello-numa
```

因为网口xgbe0的NUMA亲和node是node 0

```bash
# cat /sys/class/net/xgbe0/device/numa_node
0
```

## 4 一个有趣的问题

在NUMA架构中，不同的cpu执行内核代码时性能一样吗？

操作系统默认的NUMA策略是从本地node分配内存，那么哪个CPU加载内核态的代码，那么初始阶段分配的内存也会从该加载CPU所属的node分配。查看一下我身边一台机器的加载cpu

```bash
# dmesg | grep -i "smpboot"
[    0.170306] smpboot: CPU0: Intel(R) Xeon(R) Platinum (family: 0x6, model: 0x55, stepping: 0x4)
```

可见，这台机器是cpu0在加载内核（一般都是cpu0进行内核加载）。那么，从理论上说，cpu0所属的node（一般是node0）上的cpu执行内核代码时，性能有可能会高点呢！
