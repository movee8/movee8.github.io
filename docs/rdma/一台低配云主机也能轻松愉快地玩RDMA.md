近年来，随着AI技术的持续、迅猛高速发展，其底层依赖的GPU集群等高性能计算、存储系统也相应得到了同步的发展，随之也发现系统节点间的高性能通信效率成为制约系统发展的核心瓶颈之一。RDMA技术作为当前在高带宽和低时延通信方面表现最为突出的技术之一也备受人瞩目。RDMA对传统通信技术的一个核心优化点就是将通信协议栈的实现由软件、操作系统层面offload到了硬件层面。这样建设一个RDMA网络环境首先需要有RDMA网卡，于是我跑到淘宝、亚马逊上看了一眼：
![mellanox-price1](/images/rdma/mellanox-price1.webp)
![mellanox-price2](/images/rdma/mellanox-price2.webp)
然后我摸了摸自己的口袋，果断被劝退。

不过，我们看看RDMA的网络协议栈架构
![rdma-software-arch](/images/rdma/rdma-software-arch.webp)

可以发现RDMA的一个主流实现`RoCEv2`，它将`IP/UDP/IB transport protocol`协议栈实现从软件层面移到了网卡中，如果把`IP/UDP/IB transport protocol`协议栈重新移到软件层面实现，那么普通的以太网卡不就能支持RDMA网络通信了吗？这样虽然RDMA的性能会打点折扣，但是大大方便了RDMA网络应用的开发测试环境部署搭建、测试、故障定位和学习，而且即使部署到生产环境中，比较传统的网络内核socket通信方式，仍然带来零拷贝、内核协议栈bypass等技术性能优势。熟悉高性能网络开发的朋友们也都知道，零拷贝、内核协议栈bypass也是针对内核socket通信方式进行性能优化的核心优化手段之一。事实上，由`IBM`和`Mellanox`牵头的`IBTA` `RoCE`工作组已经实现了纯软件版的`RoCE`，我们一般叫它`SoftRoCE`。我们在常用的RoCE开发套件中，就能使用SoftRoCE。

接下来就需要准备两个以上的以太网口，而我只有一台云主机，它只有一个物理网口，而loopback口又不支持`RDMA`。那么很自然地，我们可以想到在主机上安装多个虚拟机或docker，网上很多人就是这么干的，这样就可以拥有多个虚拟网口了。不过我还是及时地又看了看我的云主机套餐，他是68元包年的，2核2G，我不太愿意`虚拟机`或`docker`占用我可怜的资源，毕竟我在这台仅有的云主机上还需要干很多其他的事情。但是，等等，docker的虚拟网卡不是基于veth虚拟网口的吗？我需要的是能用于通信的虚拟网口，而不是整个docker，那我直接使用veth虚拟网口就可以了啊！

### &#x20;1 安装RDMA开发套件

本主机使用的内核和操作系统版本

```bash
root@ecs01:~# uname -a
Linux ecs01 6.8.0-48-generic #48-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 27 14:04:52 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux
# lsb_release -a
No LSB modules are available.
Distributor ID:	Ubuntu
Description:	Ubuntu 24.04.1 LTS
Release:	24.04
Codename:	noble
```

先检查一下是否支持SoftRoCE（CONFIG\_RDMA\_RXE=m或y，说明是支持的，否则需要重新编译内核了）

```bash
root@ecs01:~# cat /boot/config-$(uname -r) | grep RXE
CONFIG_RDMA_RXE=m
```

安装开发RDMA相关依赖库和工具

```bash
root@ecs01:~# apt-get install -y libibverbs1 ibverbs-utils librdmacm1 libibumad3 ibverbs-providers rdma-core librdmacm-dev
```

查看一下已经安装的资源和位置，例如相关的RDMA命令工具：

```bash
root@ecs01:~# dpkg -L ibverbs-utils
/usr/bin/ibv_asyncwatch
/usr/bin/ibv_devices
/usr/bin/ibv_devinfo
/usr/bin/ibv_rc_pingpong
/usr/bin/ibv_srq_pingpong
/usr/bin/ibv_uc_pingpong
/usr/bin/ibv_ud_pingpong
/usr/bin/ibv_xsrq_pingpong
```

试一下其中的`ibv_devices`命令，查看一下当前系统中的RDMA设备列表

```bash
root@ecs01:~# ibv_devices
    device          	   node GUID
    ------          	----------------
```

当前系统中没有任何RDMA设备，是意料之中的

### &#x20;2 添加RDMA设备

先创建一个veth虚拟以太网

```bash
root@ecs01:~# ip link add veth-client type veth peer name veth-server
root@ecs01:~# ip addr add 192.168.1.1/24 dev veth-server
root@ecs01:~# ip addr add 192.168.1.2/24 dev veth-client
root@ecs01:~# ip link set dev veth-server up
root@ecs01:~# ip link set dev veth-client up
```

添加两个RDMA网口

```bash
root@ecs01:~# rdma link add rxe_server type rxe netdev veth-server
root@ecs01:~# rdma link add rxe_client type rxe netdev veth-client
```

这时可以看到系统多了两条RDMA链路了，也可以查看RDMA设备信息

```bash
# 链路
root@ecs01:~# rdma link
link rxe_server/1 state ACTIVE physical_state LINK_UP netdev veth-server
link rxe_client/1 state ACTIVE physical_state LINK_UP netdev veth-client

# 设备
root@ecs01:~# ibv_devices
    device          	   node GUID
    ------          	----------------
    rxe_server      	9c7ff4fffeaff293
    rxe_client      	fcc7bffffe44ca52

# 设备详细信息
root@ecs01:~# ibv_devinfo
hca_id:	rxe_server
	transport:			InfiniBand (0)
	fw_ver:				0.0.0
	node_guid:			9c7f:f4ff:feaf:f293
	sys_image_guid:			9c7f:f4ff:feaf:f293
	vendor_id:			0xffffff
	vendor_part_id:			0
	hw_ver:				0x0
	phys_port_cnt:			1
		port:	1
			state:			PORT_ACTIVE (4)
			max_mtu:		4096 (5)
			active_mtu:		1024 (3)
			sm_lid:			0
			port_lid:		0
			port_lmc:		0x00
			link_layer:		Ethernet

hca_id:	rxe_client
	transport:			InfiniBand (0)
	fw_ver:				0.0.0
	node_guid:			fcc7:bfff:fe44:ca52
	sys_image_guid:			fcc7:bfff:fe44:ca52
	vendor_id:			0xffffff
	vendor_part_id:			0
	hw_ver:				0x0
	phys_port_cnt:			1
		port:	1
			state:			PORT_ACTIVE (4)
			max_mtu:		4096 (5)
			active_mtu:		1024 (3)
			sm_lid:			0
			port_lid:		0
			port_lmc:		0x00
			link_layer:		Ethernet

# 可以通过sysfs文件系统接口查看RDMA设备信息和统计信息
root@ecs01:~# ls /sys/class/infiniband
rxe_client  rxe_server
```

### 3 ping连通性测试

在两个shell窗口中相继输入以下两个命令：

```bash
root@ecs01:~# ibv_rc_pingpong -d rxe_server -g 0
  local address:  LID 0x0000, QPN 0x000011, PSN 0xd24ed4, GID fe80::9c7f:f4ff:feaf:f293
  remote address: LID 0x0000, QPN 0x000012, PSN 0xdedad9, GID fe80::9c7f:f4ff:feaf:f293
8192000 bytes in 0.02 seconds = 2947.29 Mbit/sec
1000 iters in 0.02 seconds = 22.24 usec/iter

root@ecs01:~# ibv_rc_pingpong -d rxe_server -g 0 192.168.1.1
  local address:  LID 0x0000, QPN 0x000012, PSN 0xdedad9, GID fe80::9c7f:f4ff:feaf:f293
  remote address: LID 0x0000, QPN 0x000011, PSN 0xd24ed4, GID fe80::9c7f:f4ff:feaf:f293
8192000 bytes in 0.02 seconds = 2956.87 Mbit/sec
1000 iters in 0.02 seconds = 22.16 usec/iter
```

### 4 perftest测试

perftest功能类似于以太网络中的iperf等命令，可以用来测试RDMA程序的各项性能指标。先安装。

```bash
root@ecs01:~# apt-get -y install perftest

# perftest的相关命令工具
root@ecs01:~# dpkg -L perftest
/usr/bin/ib_atomic_bw
/usr/bin/ib_atomic_lat
/usr/bin/ib_read_bw
/usr/bin/ib_read_lat
/usr/bin/ib_send_bw
/usr/bin/ib_send_lat
/usr/bin/ib_write_bw
/usr/bin/ib_write_lat
/usr/bin/raw_ethernet_burst_lat
/usr/bin/raw_ethernet_bw
/usr/bin/raw_ethernet_fs_rate
/usr/bin/raw_ethernet_lat
/usr/bin/run_perftest_loopback
/usr/bin/run_perftest_multi_devices
```

测试RDMA SEND操作带宽，分别在两个shell窗口输入以下两个测试命令，可以看到测试结果

```bash
root@ecs01:~# ib_send_bw -d rxe_server
 WARNING: BW peak won't be measured in this run.

************************************
* Waiting for client to connect... *
************************************
---------------------------------------------------------------------------------------
                    Send BW Test
 Dual-port       : OFF		Device         : rxe_server
 Number of qps   : 1		Transport type : IB
 Connection type : RC		Using SRQ      : OFF
 PCIe relax order: ON
 ibv_wr* API     : OFF
 RX depth        : 512
 CQ Moderation   : 1
 Mtu             : 1024[B]
 Link type       : Ethernet
 GID index       : 1
 Max inline data : 0[B]
 rdma_cm QPs	 : OFF
 Data ex. method : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0013 PSN 0x7d2e4c
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
 remote address: LID 0000 QPN 0x0014 PSN 0x3db41c
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
---------------------------------------------------------------------------------------
 #bytes     #iterations    BW peak[MB/sec]    BW average[MB/sec]   MsgRate[Mpps]
 65536      1000             0.00               361.46 		   0.005783
---------------------------------------------------------------------------------------

root@ecs01:~# ib_send_bw -d rxe_server 192.168.1.1
---------------------------------------------------------------------------------------
                    Send BW Test
 Dual-port       : OFF		Device         : rxe_server
 Number of qps   : 1		Transport type : IB
 Connection type : RC		Using SRQ      : OFF
 PCIe relax order: ON
 ibv_wr* API     : OFF
 TX depth        : 128
 CQ Moderation   : 1
 Mtu             : 1024[B]
 Link type       : Ethernet
 GID index       : 1
 Max inline data : 0[B]
 rdma_cm QPs	 : OFF
 Data ex. method : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0014 PSN 0x3db41c
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
 remote address: LID 0000 QPN 0x0013 PSN 0x7d2e4c
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
---------------------------------------------------------------------------------------
 #bytes     #iterations    BW peak[MB/sec]    BW average[MB/sec]   MsgRate[Mpps]
 65536      1000             397.24             360.91 		   0.005775
---------------------------------------------------------------------------------------
```

测试RDMA SEND操作延时，分别在两个shell窗口输入以下两个测试命令

```bash
root@ecs01:~# ib_send_lat -d rxe_server

************************************
* Waiting for client to connect... *
************************************
---------------------------------------------------------------------------------------
                    Send Latency Test
 Dual-port       : OFF		Device         : rxe_server
 Number of qps   : 1		Transport type : IB
 Connection type : RC		Using SRQ      : OFF
 PCIe relax order: ON
 ibv_wr* API     : OFF
 RX depth        : 512
 Mtu             : 1024[B]
 Link type       : Ethernet
 GID index       : 1
 Max inline data : 0[B]
 rdma_cm QPs	 : OFF
 Data ex. method : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0015 PSN 0xdb44af
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
 remote address: LID 0000 QPN 0x0016 PSN 0x2b4ac1
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
---------------------------------------------------------------------------------------
 #bytes #iterations    t_min[usec]    t_max[usec]  t_typical[usec]    t_avg[usec]    t_stdev[usec]   99% percentile[usec]   99.9% percentile[usec]
 2       1000          2.85           75.69        2.95     	       3.19        	1.52   		8.92    		75.69
---------------------------------------------------------------------------------------

root@ecs01:~# ib_send_lat -d rxe_server 192.168.1.1
---------------------------------------------------------------------------------------
                    Send Latency Test
 Dual-port       : OFF		Device         : rxe_server
 Number of qps   : 1		Transport type : IB
 Connection type : RC		Using SRQ      : OFF
 PCIe relax order: ON
 ibv_wr* API     : OFF
 TX depth        : 1
 Mtu             : 1024[B]
 Link type       : Ethernet
 GID index       : 1
 Max inline data : 0[B]
 rdma_cm QPs	 : OFF
 Data ex. method : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0016 PSN 0x2b4ac1
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
 remote address: LID 0000 QPN 0x0015 PSN 0xdb44af
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:192:168:01:01
---------------------------------------------------------------------------------------
 #bytes #iterations    t_min[usec]    t_max[usec]  t_typical[usec]    t_avg[usec]    t_stdev[usec]   99% percentile[usec]   99.9% percentile[usec]
 2       1000          2.86           87.64        2.95     	       3.25        	2.72   		8.92    		87.64
---------------------------------------------------------------------------------------
```

### 5 测试自己的RDMA程序

先下载开发依赖的头文件

```bash
root@ecs01:~# apt install librdmacm-dev
root@ecs01:~# ls /usr/include/rdma/ | grep rdma_cma
rdma_cma_abi.h
rdma_cma.h
```

关于测试的RDMA程序，我这里使用github上现有的一个example程序，我们也可以参考现有的例子开发自己的程序。首先把例子代码git clone到本地

```bash
root@ecs01:~# git clone https://github.com/animeshtrivedi/rdma-example.git
root@ecs01:~# cd ./rdma-example
```

然后查看`libibverbs`和`librdmacm`的动态库文件位置，修改项目的`CMakeLists.txt`文件

```bash
root@ecs01:~/rdma-example# export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/lib/x86_64-linux-gnu

root@ecs01:~/rdma-example# dpkg -L libibverbs1
/usr/lib/x86_64-linux-gnu/libibverbs.so.1.14.50.0
/usr/lib/x86_64-linux-gnu/libibverbs.so.1

root@ecs01:~/rdma-example# dpkg -L librdmacm1t64
/usr/lib/x86_64-linux-gnu/librdmacm.so.1.3.50.0
/usr/lib/x86_64-linux-gnu/rsocket/librspreload.so
/usr/lib/x86_64-linux-gnu/librdmacm.so.1
/usr/lib/x86_64-linux-gnu/rsocket/librspreload.so.1
/usr/lib/x86_64-linux-gnu/rsocket/librspreload.so.1.0.0

root@ecs01:~/rdma-example# vim CMakeLists.txt
find_library(IBVERBS_LIBRARY libibverbs.so.1 HINTS /usr/lib/x86_64-linux-gnu)
find_library(RDMACM_LIBRARY librdmacm.so.1 HINTS /usr/lib/x86_64-linux-gnu)
```

然后编译、测试

```bash
root@ecs01:~/rdma-example# cmake .
root@ecs01:~/rdma-example# make

# 启动server端
root@ecs01:~/rdma-example# ./bin/rdma_server
Server is listening successfully at: 0.0.0.0 , port: 20886
A new connection is accepted from 192.168.1.1
Client side buffer information is received...
---------------------------------------------------------
buffer attr, addr: 0x57c3e9a792e0 , len: 10 , stag : 0xdc9
---------------------------------------------------------
The client has requested buffer length of : 10 bytes
A disconnect event is received from the client...
Server shut-down is complete

# 启动客户端
root@ecs01:~/rdma-example# ./bin/rdma_client -a 192.168.1.1 -s textstring
Passed string is : textstring , with count 10
Trying to connect to server at : 192.168.1.1 port: 20886
The client is connected successfully
---------------------------------------------------------
buffer attr, addr: 0x5ccd3a8fe600 , len: 10 , stag : 0xfee
---------------------------------------------------------
...
SUCCESS, source and destination buffers match
Client resource clean up is complete
```

