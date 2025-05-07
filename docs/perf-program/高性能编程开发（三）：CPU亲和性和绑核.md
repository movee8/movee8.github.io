在前面的文章中，我们根据NUMA架构的亲和特性，使用`numactl`命令对程序的CPU和内存访问进行绑定，从而提高程序的性能。其实，我们人为地对程序进行CPU绑定来提高程序的性能，还有一个非常重要的原因，就是提高cache的命中率。从NUMA亲和性出发，我们一般在`NUMA node`粒度上对程序进行绑定。而从cache命中率出发，我们往往在`CPU`粒度上对程序进行绑定。

本人身边有一台服务器的cpu信息如下:

```bash
# lscpu
Architecture:          x86_64
CPU op-mode(s):        32-bit, 64-bit
Byte Order:            Little Endian
CPU(s):                96
On-line CPU(s) list:   0-95
Thread(s) per core:    2
Core(s) per socket:    24
Socket(s):             2
NUMA node(s):          2
Vendor ID:             GenuineIntel
CPU family:            6
Model:                 85
Model name:            Intel(R) Xeon(R) Gold 6271C CPU @ 2.60GHz
Stepping:              7
CPU MHz:               3100.720
CPU max MHz:           3900.0000
CPU min MHz:           1000.0000
BogoMIPS:              5200.00
Virtualization:        VT-x
L1d cache:             32K
L1i cache:             32K
L2 cache:              1024K
L3 cache:              33792K
NUMA node0 CPU(s):     0-23,48-71
NUMA node1 CPU(s):     24-47,72-9
```

再查询一下主存的大小与NUMA分布：

```bash
$ numactl -H
available: 2 nodes (0-1)
node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71
node 0 size: 385224 MB
node 0 free: 371126 MB
node 1 cpus: 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95
node 1 size: 387055 MB
node 1 free: 376744 MB
node distances:
node   0   1 
  0:  10  21 
  1:  21  10
```

根据以上信息，我们可以画出这台服务器的存储结构图如下

![cpu-cache-arch](/images/perf-program/cpu-cache-arch.png)

可以看到，这台服务器有两个socket（CPU物理芯片），两个NUMA node，socket和NUMA node刚好是对应的。每个socket有24个CPU Core，每个Core有两个Hyper thread，所以每个socket有48个CPU，共96个CPU。每个socket有一个32MB大小的L3 Cache，每个CPU Core有一个1MB大小的L2 Cache，和大小均为32KB的L1 I-Cache和L1 D-Cache。每个NUMA node有384GB的主存，总共768GB主存。这样，如果系统将进程从socket 0调度到socket 1，那么原先缓存在socket 0中的L1/L2/L3 cache中数据均会失效，进程需要重新从主存中读取数据，然后刷新socket 1中各级Cache中的缓存。如果从同一个socket的不同CPU Core调度到另一个Core，则原先Core中的L1/L2 Cache将会失效，需要重新从L3或主存中读取数据。如果将进程绑定在一个CPU上运行，或只是在同一个CPU Core中的两个CPU中切换，则还可以重用之前的缓存数据。而处理器不同层级存储的访问性能的对比关系可能如下所示：

![cpu-memory-access-perf](/images/perf-program/cpu-memory-access-perf.jpg)

可见，L1 Cache、L2 Cache、L3 Cache、主存每一级间都存在几倍、几十倍的性能差距。如果能充分利用Cache，可以大幅提升程序的性能。

另外，一些外部设备的中断，可能也是由特定的CPU处理的。例如本人的一台服务器的网口xgbe0的中断是由CPU1处理的，相关信息如下：

```bash
$ cat /proc/interrupts | egrep 'CPU0|xgbe0'
            CPU0       CPU1       CPU2       CPU3       CPU4         
  51:   4293        1828571531     0          0          0      IR-PCI-MSI 6291456-edge      xgbe0-TxRx-0
$ cat /proc/irq/51/effective_affinity_list
1
$ cat /proc/irq/51/effective_affinity
0000,00000002
```

那么这个网口队列的发送和接收数据的`中断`和`软中断`（`NET_RX_SOFTIRQ`、`NET_TX_SOFTIRQ`）的处理都是由`CPU1`处理的，如果负责该网卡队列的数据接收和发送处理的应用程序也绑定在该`CPU1`上，可以充分利用各级缓存和数据的本地性，从而提高应用程序的性能

我们可以通过`taskset`命令在启动程序时对其进行绑核：

```bash
# 将程序hello绑定到CPU 1,2,3上运行
# taskset -ac 1-3 ./hello

# 也可以使用列表的方式指定CPU
# taskset -ac 1,2,3 ./hello
```

然后查询一下程序的绑核情况：

```bash
# ps -ef | grep hello
root     24983 23446  0 17:09 pts/1    00:00:00 /bin/sh ./hello
# taskset -p 24983
pid 24983's current affinity mask: e
```

与`numactl`命令不同，`taskset`命令不仅可以在启动程序时进行绑核操作，程序启动后，还可以根据`进程ID`指定或修改绑定的CPU

```bash
# taskset -cp 4-7 24983
pid 24983's current affinity list: 1-3
pid 24983's new affinity list: 4-7
# taskset -p 24983
pid 24983's current affinity mask: f0
```

上述方法只是规定了进程在指定的CPU上运行，但是系统还是可能将其他进程调度到这些CPU上，这样其他进程的数据可能冲刷掉进程的缓存数据。如果想让进程独占使用某些CPU，可以添加以下系统启动参数，然后重启系统：

```bash
# vim /etc/default/grub
GRUB_CMDLINE_LINUX="isolcpus=1-3,5,7"
```

上面通过启动参数`isolcpus=1-3,5,7`隔离了`CPU 1,2,3,5,7`。这些CPU不再参与系统的正常进程调度，除非人工将程序绑定到这些CPU上运行。如果我们只绑定一个进程在隔离的CPU上，那么`进程上下文切换`也不会发生，进程可以充分利用CPU的计算能力和缓存。

当我们使用`numactl`或`taskset`命令对程序进行绑核时，默认将程序以及它创建的子进程和线程都统一绑定指定的CPU。我们还可以在代码中对进程或线程进行绑核操作，这样我们可以`精确控制每一个进程或线程`的绑核行为

C库提供的进程绑核和获取进程绑核信息的函数：

```c
#include <sched.h>

int sched_setaffinity(pid_t pid, size_t cpusetsize, cpu_set_t *mask);
int sched_getaffinity(pid_t pid, size_t cpusetsize, cpu_set_t *mask);
```

C库提供的线程绑核和获取线程绑核信息的函数：

```c
#include <pthread.h>

int pthread_setaffinity_np(pthread_t thread, size_t cpusetsize, const cpu_set_t *cpuset);
int pthread_getaffinity_np(pthread_t thread, size_t cpusetsize, cpu_set_t *cpuset);
```

