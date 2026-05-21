use axum::http::HeaderMap;
use std::net::IpAddr;

/// Resolve the best client IP for a request.
///
/// This is display metadata for connected clients, not an authorization or rate
/// limiting primitive, so forwarded headers are accepted as best-effort hints.
pub fn resolve_client_ip(peer_ip: Option<IpAddr>, headers: &HeaderMap) -> Option<IpAddr> {
    forwarded_for_ip(headers)
        .or_else(|| forwarded_header_ip(headers))
        .or_else(|| real_ip_header(headers))
        .or(peer_ip)
}

fn forwarded_for_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|value| value.split(',').find_map(parse_ip_header_value))
}

fn forwarded_header_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get_all("forwarded")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|value| {
            value.split(',').find_map(|element| {
                element.split(';').find_map(|part| {
                    let (name, value) = part.split_once('=')?;
                    if name.trim().eq_ignore_ascii_case("for") {
                        parse_ip_header_value(value)
                    } else {
                        None
                    }
                })
            })
        })
}

fn real_ip_header(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get_all("x-real-ip")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(parse_ip_header_value)
}

fn parse_ip_header_value(value: &str) -> Option<IpAddr> {
    let value = value.trim().trim_matches('"').trim();
    if value.is_empty() || value.eq_ignore_ascii_case("unknown") || value.starts_with('_') {
        return None;
    }

    if let Ok(ip) = value.parse::<IpAddr>() {
        return Some(ip);
    }

    if let Some(value) = value.strip_prefix('[') {
        let (host, _) = value.split_once(']')?;
        return host.parse::<IpAddr>().ok();
    }

    let (host, port) = value.rsplit_once(':')?;
    if host.contains(':') || !port.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    host.parse::<IpAddr>().ok()
}

#[cfg(test)]
mod tests {
    use super::resolve_client_ip;
    use axum::http::{HeaderMap, HeaderName, HeaderValue};
    use std::net::IpAddr;

    fn ip(value: &str) -> IpAddr {
        value.parse().expect("test IP should parse")
    }

    fn headers(values: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.append(
                HeaderName::from_bytes(name.as_bytes()).expect("test header name should parse"),
                HeaderValue::from_str(value).expect("test header should parse"),
            );
        }
        headers
    }

    #[test]
    fn forwarded_headers_take_precedence_over_peer_ip() {
        let headers = headers(&[("x-forwarded-for", "192.168.1.25")]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("192.168.1.25"))
        );
    }

    #[test]
    fn uses_leftmost_x_forwarded_for_ip() {
        let headers = headers(&[("x-forwarded-for", "192.168.1.25, 10.244.1.15")]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("192.168.1.25"))
        );
    }

    #[test]
    fn skips_malformed_x_forwarded_for_values() {
        let headers = headers(&[("x-forwarded-for", "unknown, 192.168.1.25")]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("192.168.1.25"))
        );
    }

    #[test]
    fn uses_forwarded_header() {
        let headers = headers(&[(
            "forwarded",
            "for=\"[2001:db8::17]:4711\";proto=https;by=10.244.1.15",
        )]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("2001:db8::17"))
        );
    }

    #[test]
    fn uses_x_real_ip_fallback() {
        let headers = headers(&[("x-real-ip", "192.168.1.25")]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("192.168.1.25"))
        );
    }

    #[test]
    fn falls_back_to_peer_for_bad_headers() {
        let headers = headers(&[("x-forwarded-for", "bad value")]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("10.244.1.15"))
        );
    }

    #[test]
    fn falls_back_to_peer_when_headers_are_missing() {
        let headers = headers(&[]);

        assert_eq!(
            resolve_client_ip(Some(ip("10.244.1.15")), &headers),
            Some(ip("10.244.1.15"))
        );
    }

    #[test]
    fn missing_peer_ip_can_still_use_forwarded_header() {
        let headers = headers(&[("x-forwarded-for", "192.168.1.25")]);

        assert_eq!(resolve_client_ip(None, &headers), Some(ip("192.168.1.25")));
    }

    #[test]
    fn missing_peer_ip_returns_none() {
        let headers = headers(&[]);

        assert_eq!(resolve_client_ip(None, &headers), None);
    }
}
