//! Which local address the phone view binds: one private (RFC 1918) IPv4 address on an interface that
//! is up and not loopback, preferring the interface with the default route. Never `0.0.0.0`, `::`, a
//! public, link-local or carrier-grade NAT address.

use std::net::Ipv4Addr;

/// One IPv4 address of a local interface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetInterface {
    pub name: String,
    pub ipv4: Ipv4Addr,
    /// The interface is operationally up.
    pub up: bool,
    pub loopback: bool,
}

/// The local interfaces. The app reads the OS ([`SystemNetInterfaces`]); tests use
/// [`FakeNetInterfaces`].
pub trait NetInterfaces: Send + Sync {
    /// Every IPv4 address of every interface (IPv6 is out of scope).
    fn list(&self) -> Vec<NetInterface>;
    /// The name of the interface that carries the default route, if known.
    fn default_route(&self) -> Option<String>;
}

/// No suitable interface: the phone view cannot open (`phoneView.error.noLocalNetwork`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoLocalNetwork;

/// Whether the phone view may bind `ip`: a private RFC 1918 address (10/8, 172.16/12, 192.168/16).
pub fn bindable(ip: Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_unspecified() && !ip.is_loopback()
}

/// The address to bind, by the rules above. With several candidates the one with the default route
/// wins; otherwise the first in the OS's order.
pub fn choose_address(interfaces: &dyn NetInterfaces) -> Result<Ipv4Addr, NoLocalNetwork> {
    let candidates: Vec<NetInterface> = interfaces
        .list()
        .into_iter()
        .filter(|i| i.up && !i.loopback && bindable(i.ipv4))
        .collect();
    let default = interfaces.default_route();
    candidates
        .iter()
        .find(|i| Some(&i.name) == default.as_ref())
        .or_else(|| candidates.first())
        .map(|i| i.ipv4)
        .ok_or(NoLocalNetwork)
}

/// The interfaces of this device.
pub struct SystemNetInterfaces;

impl NetInterfaces for SystemNetInterfaces {
    fn list(&self) -> Vec<NetInterface> {
        match if_addrs::get_if_addrs() {
            Ok(list) => list
                .into_iter()
                .filter_map(|i| match i.addr {
                    if_addrs::IfAddr::V4(ref v4) => Some(NetInterface {
                        up: i.is_oper_up(),
                        loopback: i.is_loopback(),
                        ipv4: v4.ip,
                        name: i.name.clone(),
                    }),
                    if_addrs::IfAddr::V6(_) => None,
                })
                .collect(),
            Err(e) => {
                crate::log!("could not list the network interfaces: {}", e.kind());
                Vec::new()
            }
        }
    }

    /// Linux: the interface of the default route with the lowest metric in `/proc/net/route` (a read
    /// of the routing table; no socket). Elsewhere unknown for now (macOS and Windows are not yet
    /// built in CI): the first suitable interface in the OS's order is taken.
    fn default_route(&self) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            default_route_of(&std::fs::read_to_string("/proc/net/route").ok()?)
        }
        #[cfg(not(target_os = "linux"))]
        {
            None
        }
    }
}

/// The interface of the default route (destination and mask 0, flag up) with the lowest metric, from
/// the text of `/proc/net/route`.
pub fn default_route_of(table: &str) -> Option<String> {
    table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            let (name, dest, flags, metric, mask) =
                (f.first()?, f.get(1)?, f.get(3)?, f.get(6)?, f.get(7)?);
            let up = u32::from_str_radix(flags, 16).ok()? & 0x1 != 0;
            (*dest == "00000000" && *mask == "00000000" && up)
                .then(|| Some((metric.parse::<u32>().ok()?, (*name).to_owned())))
                .flatten()
        })
        .min()
        .map(|(_, name)| name)
}

/// Fixed interfaces for tests.
#[derive(Debug, Clone, Default)]
pub struct FakeNetInterfaces {
    pub interfaces: Vec<NetInterface>,
    /// The interface name of the default route.
    pub default_route: Option<String>,
}

impl FakeNetInterfaces {
    /// Loopback plus one Wi-Fi interface with a home-router address and the default route.
    pub fn home_wifi() -> Self {
        Self {
            interfaces: vec![
                Self::iface("lo", Ipv4Addr::LOCALHOST, true, true),
                Self::iface("wlan0", Ipv4Addr::new(192, 168, 178, 20), true, false),
            ],
            default_route: Some("wlan0".into()),
        }
    }

    pub fn iface(name: &str, ipv4: Ipv4Addr, up: bool, loopback: bool) -> NetInterface {
        NetInterface {
            name: name.into(),
            ipv4,
            up,
            loopback,
        }
    }
}

impl NetInterfaces for FakeNetInterfaces {
    fn list(&self) -> Vec<NetInterface> {
        self.interfaces.clone()
    }
    fn default_route(&self) -> Option<String> {
        self.default_route.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake(list: Vec<NetInterface>, default_route: Option<&str>) -> FakeNetInterfaces {
        FakeNetInterfaces {
            interfaces: list,
            default_route: default_route.map(str::to_owned),
        }
    }
    use FakeNetInterfaces as F;

    #[test]
    fn only_private_rfc1918_addresses_are_bindable() {
        for ok in ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20"] {
            assert!(bindable(ok.parse().unwrap()), "{ok}");
        }
        for no in [
            "0.0.0.0",
            "127.0.0.1",
            "8.8.8.8",
            "172.32.0.1",
            "169.254.10.1",
            "100.64.0.1",
            "192.0.2.1",
            "255.255.255.255",
            "224.0.0.1",
        ] {
            assert!(!bindable(no.parse().unwrap()), "{no}");
        }
    }

    #[test]
    fn chooses_the_private_up_non_loopback_address() {
        assert_eq!(
            choose_address(&F::home_wifi()),
            Ok(Ipv4Addr::new(192, 168, 178, 20))
        );
    }

    #[test]
    fn prefers_the_interface_with_the_default_route() {
        let list = vec![
            F::iface("eth0", Ipv4Addr::new(10, 0, 0, 7), true, false),
            F::iface("wlan0", Ipv4Addr::new(192, 168, 1, 30), true, false),
        ];
        assert_eq!(
            choose_address(&fake(list.clone(), Some("wlan0"))),
            Ok(Ipv4Addr::new(192, 168, 1, 30))
        );
        assert_eq!(
            choose_address(&fake(list.clone(), Some("eth0"))),
            Ok(Ipv4Addr::new(10, 0, 0, 7))
        );
        // No default route, or one through another interface: the first private one.
        assert_eq!(
            choose_address(&fake(list.clone(), None)),
            Ok(Ipv4Addr::new(10, 0, 0, 7))
        );
        assert_eq!(
            choose_address(&fake(list, Some("wwan0"))),
            Ok(Ipv4Addr::new(10, 0, 0, 7))
        );
    }

    #[test]
    fn never_a_down_loopback_public_or_link_local_interface() {
        let list = vec![
            F::iface("lo", Ipv4Addr::LOCALHOST, true, true),
            F::iface("eth1", Ipv4Addr::new(192, 168, 2, 2), false, false),
            F::iface("wwan0", Ipv4Addr::new(81, 2, 3, 4), true, false),
            F::iface("eth2", Ipv4Addr::new(169, 254, 3, 3), true, false),
            F::iface("tun0", Ipv4Addr::new(100, 64, 1, 1), true, false),
            F::iface("weird", Ipv4Addr::UNSPECIFIED, true, false),
        ];
        // The default route through the public address is not taken either.
        assert_eq!(
            choose_address(&fake(list, Some("wwan0"))),
            Err(NoLocalNetwork)
        );
        // A private address marked as loopback is not taken.
        let odd = vec![F::iface("lo2", Ipv4Addr::new(10, 1, 1, 1), true, true)];
        assert_eq!(choose_address(&fake(odd, None)), Err(NoLocalNetwork));
        assert_eq!(choose_address(&fake(vec![], None)), Err(NoLocalNetwork));
    }

    #[test]
    fn the_default_route_is_read_from_the_routing_table() {
        let table =
            "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n\
            wlan0\t00000000\t01B2A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n\
            eth0\t00000000\t0100000A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n\
            eth0\t0000000A\t00000000\t0001\t0\t0\t100\t000000FF\t0\t0\t0\n\
            tun0\t00000000\t00000000\t0000\t0\t0\t1\t00000000\t0\t0\t0\n";
        assert_eq!(default_route_of(table).as_deref(), Some("eth0"));
        assert_eq!(default_route_of("Iface\tDestination\n"), None);
        assert_eq!(default_route_of(""), None);
    }
}
