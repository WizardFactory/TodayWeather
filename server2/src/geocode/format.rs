/// Match JavaScript Number.toFixed(3), including binary half boundaries.
/// Multiplying a float by 1000 first loses the distinctions used by toFixed.
pub fn normalize_loc(loc: [f64; 2]) -> [f64; 2] {
    loc.map(|value| {
        if !value.is_finite() || value.abs() >= 1e21 {
            return value;
        }
        let bits = value.abs().to_bits();
        let exponent = ((bits >> 52) & 0x7ff) as i32;
        let mantissa = (bits & ((1_u64 << 52) - 1)) | if exponent == 0 { 0 } else { 1_u64 << 52 };
        let power = if exponent == 0 {
            -1074
        } else {
            exponent - 1023 - 52
        };
        let scaled = u128::from(mantissa) * 1000;
        let integer = if power >= 0 {
            // Geographic coordinates are bounded by 180 before this helper.
            scaled.checked_shl(power as u32).unwrap_or(0)
        } else {
            let shift = (-power) as u32;
            if shift >= 128 {
                0
            } else {
                let divisor = 1_u128 << shift;
                let quotient = scaled / divisor;
                quotient + u128::from(scaled % divisor >= divisor / 2)
            }
        };
        if integer == 0 {
            0.0
        } else {
            (integer as f64 / 1000.0).copysign(value)
        }
    })
}

pub fn language_from_header(header: Option<&str>) -> String {
    let value = header.unwrap_or("en").split('-').next().unwrap_or("");
    if value.encode_utf16().count() > 64 {
        "en".into()
    } else {
        value.into()
    }
}

pub fn is_korea_area(loc: [f64; 2]) -> bool {
    (32.6942..=39.3769).contains(&loc[0]) && (123.9523..=131.88).contains(&loc[1])
}
