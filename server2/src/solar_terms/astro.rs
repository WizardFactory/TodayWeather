//! Pure-Rust port of CosineKitty Astronomy Engine 2.1.19 `SearchSunLongitude`.
//!
//! Upstream: https://github.com/cosinekitty/astronomy
//! License: MIT License, Copyright (c) 2019-2025 Don Cross <cosinekitty@gmail.com>
//!
//! Computes the instant when the Sun's apparent geocentric ecliptic longitude
//! (corrected for light travel time, precession, and IAU 2000B nutation on the
//! Espenak-Meeus Delta-T timescale) crosses a target angle in `[0, 360)` degrees.

use std::f64::consts::PI;

pub const ALGORITHM: &str = "astronomy-engine/2.1.19";

const C_AUDAY: f64 = 173.144_632_684_669_3;
const DEG2RAD: f64 = 0.017_453_292_519_943_296;
const RAD2DEG: f64 = 57.295_779_513_082_32;
const DAYS_PER_TROPICAL_YEAR: f64 = 365.242_17;
const DAYS_PER_MILLENNIUM: f64 = 365_250.0;
const SECONDS_PER_DAY: f64 = 86_400.0;
const MILLIS_PER_DAY: f64 = 86_400_000.0;
/// Unix epoch ms of J2000.0 (`2000-01-01T12:00:00Z`).
const J2000_UNIX_MS: f64 = 946_728_000_000.0;
const PI2: f64 = 2.0 * PI;
const ASEC2RAD: f64 = 4.848_136_811_095_36e-6;
const ASEC360: f64 = 2.0 * 180.0 * 60.0 * 60.0;

#[derive(Clone, Copy, Debug)]
struct AstroTime {
    ut: f64,
    tt: f64,
}

impl AstroTime {
    fn from_ut(ut: f64) -> Self {
        Self {
            ut,
            tt: ut + delta_t_espenak_meeus(ut) / SECONDS_PER_DAY,
        }
    }

    fn from_unix_ms(ms: f64) -> Self {
        Self::from_ut((ms - J2000_UNIX_MS) / MILLIS_PER_DAY)
    }

    fn unix_ms(self) -> f64 {
        J2000_UNIX_MS + self.ut * MILLIS_PER_DAY
    }

    fn add_days(self, days: f64) -> Self {
        Self::from_ut(self.ut + days)
    }
}

fn delta_t_espenak_meeus(ut: f64) -> f64 {
    let y = 2000.0 + ((ut - 14.0) / DAYS_PER_TROPICAL_YEAR);
    if y < -500.0 {
        let u = (y - 1820.0) / 100.0;
        return -20.0 + (32.0 * u * u);
    }
    if y < 500.0 {
        let u = y / 100.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        let u5 = u2 * u3;
        let u6 = u3 * u3;
        return 10583.6 - 1014.41 * u + 33.78311 * u2 - 5.952053 * u3 - 0.1798452 * u4
            + 0.022174192 * u5
            + 0.0090316521 * u6;
    }
    if y < 1600.0 {
        let u = (y - 1000.0) / 100.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        let u5 = u2 * u3;
        let u6 = u3 * u3;
        return 1574.2 - 556.01 * u + 71.23472 * u2 + 0.319781 * u3
            - 0.8503463 * u4
            - 0.005050998 * u5
            + 0.0083572073 * u6;
    }
    if y < 1700.0 {
        let u = y - 1600.0;
        let u2 = u * u;
        let u3 = u * u2;
        return 120.0 - 0.9808 * u - 0.01532 * u2 + u3 / 7129.0;
    }
    if y < 1800.0 {
        let u = y - 1700.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        return 8.83 + 0.1603 * u - 0.0059285 * u2 + 0.00013336 * u3 - u4 / 1_174_000.0;
    }
    if y < 1860.0 {
        let u = y - 1800.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        let u5 = u2 * u3;
        let u6 = u3 * u3;
        let u7 = u3 * u4;
        return 13.72 - 0.332447 * u + 0.0068612 * u2 + 0.0041116 * u3 - 0.00037436 * u4
            + 0.0000121272 * u5
            - 0.0000001699 * u6
            + 0.000000000875 * u7;
    }
    if y < 1900.0 {
        let u = y - 1860.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        let u5 = u2 * u3;
        return 7.62 + 0.5737 * u - 0.251754 * u2 + 0.01680668 * u3 - 0.0004473624 * u4
            + u5 / 233_174.0;
    }
    if y < 1920.0 {
        let u = y - 1900.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        return -2.79 + 1.494119 * u - 0.0598939 * u2 + 0.0061966 * u3 - 0.000197 * u4;
    }
    if y < 1941.0 {
        let u = y - 1920.0;
        let u2 = u * u;
        let u3 = u * u2;
        return 21.20 + 0.84493 * u - 0.076100 * u2 + 0.0020936 * u3;
    }
    if y < 1961.0 {
        let u = y - 1950.0;
        let u2 = u * u;
        let u3 = u * u2;
        return 29.07 + 0.407 * u - u2 / 233.0 + u3 / 2547.0;
    }
    if y < 1986.0 {
        let u = y - 1975.0;
        let u2 = u * u;
        let u3 = u * u2;
        return 45.45 + 1.067 * u - u2 / 260.0 - u3 / 718.0;
    }
    if y < 2005.0 {
        let u = y - 2000.0;
        let u2 = u * u;
        let u3 = u * u2;
        let u4 = u2 * u2;
        let u5 = u2 * u3;
        return 63.86 + 0.3345 * u - 0.060374 * u2
            + 0.0017275 * u3
            + 0.000651814 * u4
            + 0.00002373599 * u5;
    }
    if y < 2050.0 {
        let u = y - 2000.0;
        return 62.92 + 0.32217 * u + 0.005589 * u * u;
    }
    if y < 2150.0 {
        let u = (y - 1820.0) / 100.0;
        return -20.0 + 32.0 * u * u - 0.5628 * (2150.0 - y);
    }
    let u = (y - 1820.0) / 100.0;
    -20.0 + (32.0 * u * u)
}

#[allow(clippy::excessive_precision)]
const EARTH_LON: &[&[[f64; 3]]] = &[
    &[
        [1.75347045673, 0.00000000000, 0.00000000000],
        [0.03341656453, 4.66925680415, 6283.07584999140],
        [0.00034894275, 4.62610242189, 12566.15169998280],
        [0.00003417572, 2.82886579754, 3.52311834900],
        [0.00003497056, 2.74411783405, 5753.38488489680],
        [0.00003135899, 3.62767041756, 77713.77146812050],
        [0.00002676218, 4.41808345438, 7860.41939243920],
        [0.00002342691, 6.13516214446, 3930.20969621960],
        [0.00001273165, 2.03709657878, 529.69096509460],
        [0.00001324294, 0.74246341673, 11506.76976979360],
        [0.00000901854, 2.04505446477, 26.29831979980],
        [0.00001199167, 1.10962946234, 1577.34354244780],
        [0.00000857223, 3.50849152283, 398.14900340820],
        [0.00000779786, 1.17882681962, 5223.69391980220],
        [0.00000990250, 5.23268072088, 5884.92684658320],
        [0.00000753141, 2.53339052847, 5507.55323866740],
        [0.00000505267, 4.58292599973, 18849.22754997420],
        [0.00000492392, 4.20505711826, 775.52261132400],
        [0.00000356672, 2.91954114478, 0.06731030280],
        [0.00000284125, 1.89869240932, 796.29800681640],
        [0.00000242879, 0.34481445893, 5486.77784317500],
        [0.00000317087, 5.84901948512, 11790.62908865880],
        [0.00000271112, 0.31486255375, 10977.07880469900],
        [0.00000206217, 4.80646631478, 2544.31441988340],
        [0.00000205478, 1.86953770281, 5573.14280143310],
        [0.00000202318, 2.45767790232, 6069.77675455340],
        [0.00000126225, 1.08295459501, 20.77539549240],
        [0.00000155516, 0.83306084617, 213.29909543800],
    ],
    &[
        [6283.07584999140, 0.00000000000, 0.00000000000],
        [0.00206058863, 2.67823455808, 6283.07584999140],
        [0.00004303419, 2.63512233481, 12566.15169998280],
    ],
    &[[0.00008721859, 1.07253635559, 6283.07584999140]],
];

#[allow(clippy::excessive_precision)]
const EARTH_LAT: &[&[[f64; 3]]] = &[
    &[],
    &[
        [0.00227777722, 3.41376620530, 6283.07584999140],
        [0.00003805678, 3.37063423795, 12566.15169998280],
    ],
];

#[allow(clippy::excessive_precision)]
const EARTH_RAD: &[&[[f64; 3]]] = &[
    &[
        [1.00013988784, 0.00000000000, 0.00000000000],
        [0.01670699632, 3.09846350258, 6283.07584999140],
        [0.00013956024, 3.05524609456, 12566.15169998280],
        [0.00003083720, 5.19846674381, 77713.77146812050],
        [0.00001628463, 1.17387558054, 5753.38488489680],
        [0.00001575572, 2.84685214877, 7860.41939243920],
        [0.00000924799, 5.45292236722, 11506.76976979360],
        [0.00000542439, 4.56409151453, 3930.20969621960],
        [0.00000472110, 3.66100022149, 5884.92684658320],
        [0.00000085831, 1.27079125277, 161000.68573767410],
        [0.00000057056, 2.01374292245, 83996.84731811189],
        [0.00000055736, 5.24159799170, 71430.69561812909],
        [0.00000174844, 3.01193636733, 18849.22754997420],
        [0.00000243181, 4.27349530790, 11790.62908865880],
    ],
    &[
        [0.00103018607, 1.10748968172, 6283.07584999140],
        [0.00001721238, 1.06442300386, 12566.15169998280],
    ],
    &[[0.00004359385, 5.78455133808, 6283.07584999140]],
];

fn vsop_formula(formula: &[&[[f64; 3]]], t: f64, clamp_angle: bool) -> f64 {
    let mut tpower = 1.0;
    let mut coord = 0.0;
    for series in formula {
        let mut sum = 0.0;
        for &[ampl, phas, freq] in *series {
            sum += ampl * (phas + (t * freq)).cos();
        }
        let mut incr = tpower * sum;
        if clamp_angle {
            incr %= PI2;
        }
        coord += incr;
        tpower *= t;
    }
    coord
}

fn calc_vsop_earth(time: AstroTime) -> [f64; 3] {
    let t = time.tt / DAYS_PER_MILLENNIUM;
    let lon = vsop_formula(EARTH_LON, t, true);
    let lat = vsop_formula(EARTH_LAT, t, false);
    let rad = vsop_formula(EARTH_RAD, t, false);
    let r_coslat = rad * lat.cos();
    let eclip = [r_coslat * lon.cos(), r_coslat * lon.sin(), rad * lat.sin()];
    [
        eclip[0] + 0.000_000_440_360 * eclip[1] - 0.000_000_190_919 * eclip[2],
        -0.000_000_479_966 * eclip[0] + 0.917_482_137_087 * eclip[1] - 0.397_776_982_902 * eclip[2],
        0.397_776_982_902 * eclip[1] + 0.917_482_137_087 * eclip[2],
    ]
}

fn iau2000b(time: AstroTime) -> (f64, f64) {
    let modulus = |x: f64| (x % ASEC360) * ASEC2RAD;
    let t = time.tt / 36_525.0;
    let elp = modulus(1_287_104.793_05 + t * 129_596_581.048_1);
    let f = modulus(335_779.526_232 + t * 1_739_527_262.847_8);
    let d = modulus(1_072_260.703_69 + t * 1_602_961_601.209_0);
    let om = modulus(450_160.398_036 - t * 6_962_890.543_1);

    let (sarg, carg) = om.sin_cos();
    let mut dp = (-172_064_161.0 - 174_666.0 * t) * sarg + 33_386.0 * carg;
    let mut de = (92_052_331.0 + 9_086.0 * t) * carg + 15_377.0 * sarg;

    let (sarg, carg) = (2.0 * (f - d + om)).sin_cos();
    dp += (-13_170_906.0 - 1_675.0 * t) * sarg - 13_696.0 * carg;
    de += (5_730_336.0 - 3_015.0 * t) * carg - 4_587.0 * sarg;

    let (sarg, carg) = (2.0 * (f + om)).sin_cos();
    dp += (-2_276_413.0 - 234.0 * t) * sarg + 2_796.0 * carg;
    de += (978_459.0 - 485.0 * t) * carg + 1_374.0 * sarg;

    let (sarg, carg) = (2.0 * om).sin_cos();
    dp += (2_074_554.0 + 207.0 * t) * sarg - 698.0 * carg;
    de += (-897_492.0 + 470.0 * t) * carg - 291.0 * sarg;

    let (sarg, carg) = elp.sin_cos();
    dp += (1_475_877.0 - 3_633.0 * t) * sarg + 11_817.0 * carg;
    de += (73_871.0 - 184.0 * t) * carg - 1_924.0 * sarg;

    (-0.000_135 + dp * 1.0e-7, 0.000_388 + de * 1.0e-7)
}

fn mean_obliq(time: AstroTime) -> f64 {
    let t = time.tt / 36_525.0;
    let asec = (((((-0.000_000_043_4 * t - 0.000_000_576) * t + 0.002_003_40) * t - 0.000_183_1)
        * t
        - 46.836_769)
        * t)
        + 84_381.406;
    asec / 3600.0
}

struct Tilt {
    dpsi: f64,
    mobl: f64,
    tobl: f64,
}

fn e_tilt(time: AstroTime) -> Tilt {
    let (dpsi, deps) = iau2000b(time);
    let mobl = mean_obliq(time);
    Tilt {
        dpsi,
        mobl,
        tobl: mobl + deps / 3600.0,
    }
}

fn rotate(rot: [[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        rot[0][0] * v[0] + rot[1][0] * v[1] + rot[2][0] * v[2],
        rot[0][1] * v[0] + rot[1][1] * v[1] + rot[2][1] * v[2],
        rot[0][2] * v[0] + rot[1][2] * v[1] + rot[2][2] * v[2],
    ]
}

fn precession_from_2000(pos: [f64; 3], time: AstroTime) -> [f64; 3] {
    let t = time.tt / 36_525.0;
    let eps0 = 84_381.406 * ASEC2RAD;
    let psia = (((((-0.000_000_095_1 * t + 0.000_132_851) * t - 0.001_140_45) * t - 1.079_006_9)
        * t
        + 5_038.481_507)
        * t)
        * ASEC2RAD;
    let omegaa = (((((0.000_000_333_7 * t - 0.000_000_467) * t - 0.007_725_03) * t + 0.051_262_3)
        * t
        - 0.025_754)
        * t
        + 84_381.406)
        * ASEC2RAD;
    let chia = (((((-0.000_000_056_0 * t + 0.000_170_663) * t - 0.001_211_97) * t - 2.381_429_2)
        * t
        + 10.556_403)
        * t)
        * ASEC2RAD;

    let (sa, ca) = eps0.sin_cos();
    let (sb, cb) = (-psia).sin_cos();
    let (sc, cc) = (-omegaa).sin_cos();
    let (sd, cd) = chia.sin_cos();

    let xx = cd * cb - sb * sd * cc;
    let yx = cd * sb * ca + sd * cc * cb * ca - sa * sd * sc;
    let zx = cd * sb * sa + sd * cc * cb * sa + ca * sd * sc;
    let xy = -sd * cb - sb * cd * cc;
    let yy = -sd * sb * ca + cd * cc * cb * ca - sa * cd * sc;
    let zy = -sd * sb * sa + cd * cc * cb * sa + ca * cd * sc;
    let xz = sb * sc;
    let yz = -sc * cb * ca - sa * cc;
    let zz = -sc * cb * sa + cc * ca;

    rotate([[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]], pos)
}

fn nutation_from_2000(pos: [f64; 3], tilt: &Tilt) -> [f64; 3] {
    let (sobm, cobm) = (tilt.mobl * DEG2RAD).sin_cos();
    let (sobt, cobt) = (tilt.tobl * DEG2RAD).sin_cos();
    let (spsi, cpsi) = (tilt.dpsi * ASEC2RAD).sin_cos();

    let xx = cpsi;
    let yx = -spsi * cobm;
    let zx = -spsi * sobm;
    let xy = spsi * cobt;
    let yy = cpsi * cobm * cobt + sobm * sobt;
    let zy = cpsi * sobm * cobt - cobm * sobt;
    let xz = spsi * sobt;
    let yz = cpsi * cobm * sobt - sobm * cobt;
    let zz = cpsi * sobm * sobt + cobm * cobt;

    rotate([[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]], pos)
}

fn sun_ecliptic_longitude(time: AstroTime) -> f64 {
    let back = time.add_days(-1.0 / C_AUDAY);
    let earth = calc_vsop_earth(back);
    let sun2000 = [-earth[0], -earth[1], -earth[2]];
    let tilt = e_tilt(back);
    let prec = precession_from_2000(sun2000, back);
    let [gx, gy, gz] = nutation_from_2000(prec, &tilt);
    let (sin_ob, cos_ob) = (DEG2RAD * tilt.tobl).sin_cos();
    let ex = gx;
    let ey = gy * cos_ob + gz * sin_ob;
    let xyproj = ex.hypot(ey);
    if xyproj > 0.0 {
        let mut elon = RAD2DEG * ey.atan2(ex);
        if elon < 0.0 {
            elon += 360.0;
        }
        elon
    } else {
        0.0
    }
}

fn longitude_offset(mut offset: f64) -> f64 {
    while offset <= -180.0 {
        offset += 360.0;
    }
    while offset > 180.0 {
        offset -= 360.0;
    }
    offset
}

fn quad_interp(tm: f64, dt: f64, fa: f64, fm: f64, fb: f64) -> Option<(f64, f64)> {
    let q = (fb + fa) / 2.0 - fm;
    let r = (fb - fa) / 2.0;
    let s = fm;
    let x = if q == 0.0 {
        if r == 0.0 {
            return None;
        }
        let x = -s / r;
        if !(-1.0..=1.0).contains(&x) {
            return None;
        }
        x
    } else {
        let u = r * r - 4.0 * q * s;
        if u <= 0.0 {
            return None;
        }
        let ru = u.sqrt();
        let x1 = (-r + ru) / (2.0 * q);
        let x2 = (-r - ru) / (2.0 * q);
        let in1 = (-1.0..=1.0).contains(&x1);
        let in2 = (-1.0..=1.0).contains(&x2);
        match (in1, in2) {
            (true, false) => x1,
            (false, true) => x2,
            _ => return None,
        }
    };
    Some((tm + x * dt, (2.0 * q * x + r) / dt))
}

/// Find the UTC Unix timestamp (in milliseconds) when the Sun reaches `target_lon` degrees
/// within `[start_unix_ms, start_unix_ms + limit_days * 86_400_000]`.
pub fn search_sun_longitude(target_lon: f64, start_unix_ms: f64, limit_days: f64) -> Option<i64> {
    if !target_lon.is_finite() || !start_unix_ms.is_finite() || !limit_days.is_finite() {
        return None;
    }
    let eval = |t: AstroTime| longitude_offset(sun_ecliptic_longitude(t) - target_lon);
    let mut t1 = AstroTime::from_unix_ms(start_unix_ms);
    let mut t2 = t1.add_days(limit_days);
    let dt_days = (0.01_f64 / SECONDS_PER_DAY).abs();
    let mut f1 = eval(t1);
    let mut f2 = eval(t2);
    let mut fmid = f64::NAN;
    let mut calc_fmid = true;

    for _ in 0..20 {
        let tmid = AstroTime::from_ut(t1.ut + 0.5 * (t2.ut - t1.ut));
        let dt = tmid.ut - t1.ut;
        if dt.abs() < dt_days {
            return Some(tmid.unix_ms().round() as i64);
        }
        if calc_fmid {
            fmid = eval(tmid);
        } else {
            calc_fmid = true;
        }
        if let Some((qt, df_dt)) = quad_interp(tmid.ut, t2.ut - tmid.ut, f1, fmid, f2) {
            let tq = AstroTime::from_ut(qt);
            let fq = eval(tq);
            if df_dt != 0.0 {
                if (fq / df_dt).abs() < dt_days {
                    return Some(tq.unix_ms().round() as i64);
                }
                let dt_guess = 1.2 * (fq / df_dt).abs();
                if dt_guess < dt / 10.0 {
                    let tleft = tq.add_days(-dt_guess);
                    let tright = tq.add_days(dt_guess);
                    if (tleft.ut - t1.ut) * (tleft.ut - t2.ut) < 0.0
                        && (tright.ut - t1.ut) * (tright.ut - t2.ut) < 0.0
                    {
                        let fleft = eval(tleft);
                        let fright = eval(tright);
                        if fleft < 0.0 && fright >= 0.0 {
                            f1 = fleft;
                            f2 = fright;
                            t1 = tleft;
                            t2 = tright;
                            fmid = fq;
                            calc_fmid = false;
                            continue;
                        }
                    }
                }
            }
        }
        if f1 < 0.0 && fmid >= 0.0 {
            t2 = tmid;
            f2 = fmid;
            continue;
        }
        if fmid < 0.0 && f2 >= 0.0 {
            t1 = tmid;
            f1 = fmid;
            continue;
        }
        return None;
    }
    None
}
