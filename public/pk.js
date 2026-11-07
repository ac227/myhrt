// 血药浓度估算。解析式与默认参数来自 Oyama's HRT Tracker（MIT）对
// LaoZhong 三室模型的移植：剂量是化合物本身的毫克，曲线是估算，不是化验。
(function () {
  const UNMODELLED = new Set(['SPIRO', 'BICA', 'MPA', 'LEUP', 'TRIP', 'RLX']);
  const T_ESTERS = new Set(['T', 'TC', 'TE', 'TU']);
  const E2_MW = 272.38;
  const T_MW = 288.42;
  const MW = {
    E2: 272.38, EB: 376.5, EV: 356.5, EC: 396.58, EN: 384.56, EU: 440.66,
    T: 288.42, TC: 412.6, TE: 400.59, TU: 456.7,
  };
  const E2_DEPOT = {
    EB: { frac: 0.9, k1f: 0.144, k1s: 0.114, k2: 0.09, ff: 0.1092 },
    EV: { frac: 0.4, k1f: 0.0216, k1s: 0.0138, k2: 0.07, ff: 0.0623 },
    EC: { frac: 0.229164549, k1f: 0.005035046, k1s: 0.004510574, k2: 0.045, ff: 0.1173 },
    EN: { frac: 0.05, k1f: 0.001, k1s: 0.005, k2: 0.015, ff: 0.12 },
    EU: { frac: 0.08, k1f: 0.006, k1s: 0.0022, k2: 0.012, ff: 0.04 },
    E2: { frac: 1, k1f: 0.5, k1s: 0, k2: 0, ff: 1 },
  };
  const T_DEPOT = {
    TC: { frac: 0.35, k1f: 0.025, k1s: 0.005, k2: 0.2, ff: 0.043 },
    TE: { frac: 0.4, k1f: 0.035, k1s: 0.008, k2: 0.2, ff: 0.043 },
    TU: { frac: 0, k1f: Math.LN2 / (50 * 24), k1s: Math.LN2 / (50 * 24), k2: 0.036, ff: 0.043 },
  };
  const E2_K3 = 0.41;
  const E2_K3_INJ = 0.041;
  const T_K3 = 0.5;
  const T_K3_INJ = 0.035;
  const ORAL_BIO = 0.03;
  const ORAL_K_E2 = 0.32;
  const ORAL_K_EV = 0.05;
  const ORAL_K_E1 = Math.LN2 / 14.36;
  const SL_K = 1.8;
  const GEL_K = 0.0193;
  const GEL_F = [0.05, 0.05, 0.25];
  const T_GEL_F = [0.1, 0.1, 0.5];
  const T_GEL_K = 0.05;
  const SL_TIERS = [[2, 0.01], [5, 0.04], [10, 0.11], [15, 0.18]];
  const CPA = (() => {
    const alpha = 0.25;
    const beta = Math.LN2 / 43.9;
    const wFast = 5.2786;
    const exposureH = 14 / (0.0035 * 60);
    return { F: 0.88, ka: 0.5, alpha, beta, wFast, wSlow: (exposureH - wFast / alpha) * beta };
  })();

  function toFactor(ester) {
    if (ester === 'E2' || ester === 'CPA' || UNMODELLED.has(ester)) return 1;
    if (T_ESTERS.has(ester)) return T_MW / (MW[ester] || T_MW);
    return E2_MW / (MW[ester] || E2_MW);
  }

  function thetaFromHold(min) {
    if (!(min > 0)) return 0;
    const pts = SL_TIERS;
    if (min <= pts[0][0]) {
      const slope = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
      return Math.min(1, Math.max(0, pts[0][1] + (min - pts[0][0]) * slope));
    }
    if (min >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [h1, t1] = pts[i];
      const [h2, t2] = pts[i + 1];
      if (min >= h1 && min <= h2) return t1 + ((min - h1) / (h2 - h1)) * (t2 - t1);
    }
    return 0.11;
  }

  function holdFromTheta(theta) {
    if (!(theta > 0)) return '';
    const pts = SL_TIERS;
    if (theta <= pts[0][1]) return String(Math.round(pts[0][0]));
    if (theta >= pts[pts.length - 1][1]) return String(pts[pts.length - 1][0]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [h1, t1] = pts[i];
      const [h2, t2] = pts[i + 1];
      if (theta >= t1 && theta <= t2) return String(Math.round(h1 + ((theta - t1) / (t2 - t1)) * (h2 - h1)));
    }
    return '';
  }

  function expDiv1(x, y, tau) {
    const z = (Math.abs(y - x) * tau) / 2;
    if (z > 1) return (Math.exp(-x * tau) - Math.exp(-y * tau)) / (x - y);
    const sinhc = z === 0 ? 1 : Math.sinh(z) / z;
    return -tau * Math.exp((-(x + y) / 2) * tau) * sinhc;
  }

  function expDiv2(a, b, c, tau) {
    if (a > b) { const t = a; a = b; b = t; }
    if (b > c) { const t = b; b = c; c = t; }
    if (a > b) { const t = a; a = b; b = t; }
    if ((c - a) * tau >= 0.5) return (expDiv1(b, c, tau) - expDiv1(a, b, tau)) / (c - a);
    const mean = (a + b + c) / 3;
    const ua = (mean - a) * tau;
    const ub = (mean - b) * tau;
    const uc = (mean - c) * tau;
    let h1 = 1; let h2 = 1; let h3 = 1; let fact = 2; let sum = 0.5;
    for (let j = 1; j < 20; j++) {
      h1 *= ua;
      h2 = h1 + ub * h2;
      h3 = h2 + uc * h3;
      fact *= j + 2;
      sum += h3 / fact;
    }
    return tau * tau * Math.exp(-mean * tau) * sum;
  }

  function a2(tau, dose, F, ka, ke) {
    if (ka <= 0 || dose <= 0 || tau < 0) return 0;
    return -dose * F * ka * expDiv1(ka, ke, tau);
  }

  function a3(tau, dose, F, k1, k2, k3) {
    if (k1 <= 0 || k2 <= 0 || dose <= 0 || tau < 0) return 0;
    return dose * F * k1 * k2 * expDiv2(k1, k2, k3, tau);
  }

  function siteIndex(extras) {
    const n = Number(extras && extras.gelSite);
    if (!Number.isFinite(n)) return 0;
    return Math.min(2, Math.max(0, Math.round(n)));
  }

  function slTheta(extras) {
    const raw = extras && extras.sublingualTheta;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw > 1) return thetaFromHold(raw);
      return Math.min(1, Math.max(0, raw));
    }
    const tier = extras && extras.sublingualTier;
    if (typeof tier === 'number' && Number.isFinite(tier)) return SL_TIERS[Math.min(3, Math.max(0, Math.round(tier)))][1];
    return 0.11;
  }

  function hormoneOf(ester) {
    if (ester === 'CPA') return 'cpa';
    if (T_ESTERS.has(ester)) return 't';
    return 'e2';
  }

  function wearHours(event, events) {
    const planned = event.extras && event.extras.patchWearH;
    let wear = typeof planned === 'number' && planned > 0 ? planned : 7 * 24;
    const hormone = hormoneOf(event.ester);
    for (const other of events) {
      if (other.route !== 'patchRemove' || other.timeH <= event.timeH) continue;
      if (hormoneOf(other.ester) !== hormone) continue;
      const gap = other.timeH - event.timeH;
      if (gap >= 1 && gap < wear) wear = gap;
    }
    return wear;
  }

  function compile(event, events) {
    const ester = event.ester;
    const dose = Number(event.doseMG) || 0;
    const extras = event.extras || {};
    const start = event.timeH;
    const factor = toFactor(ester);
    const hormone = hormoneOf(ester);
    if (UNMODELLED.has(ester) || event.route === 'patchRemove' || dose < 0) return null;

    let fn = null;
    let life = 24 * 40;

    if (ester === 'CPA') {
      if (event.route !== 'oral') return null;
      fn = (t) => {
        const tau = t - start;
        if (tau < 0) return 0;
        return a2(tau, dose, CPA.F * CPA.wFast, CPA.ka, CPA.alpha)
          + a2(tau, dose, CPA.F * CPA.wSlow, CPA.ka, CPA.beta);
      };
      life = 13.816 / CPA.beta;
    } else if (T_ESTERS.has(ester)) {
      const k3 = event.route === 'injection' ? T_K3_INJ : T_K3;
      if (event.route === 'injection' && T_DEPOT[ester]) {
        const d = T_DEPOT[ester];
        const F = d.ff * factor;
        fn = (t) => {
          const tau = t - start;
          if (tau < 0) return 0;
          return a3(tau, dose * d.frac, F, d.k1f, d.k2, k3) + a3(tau, dose * (1 - d.frac), F, d.k1s, d.k2, k3);
        };
      } else if (event.route === 'gel') {
        const F = T_GEL_F[siteIndex(extras)] * factor;
        fn = (t) => a2(t - start, dose, F, T_GEL_K, k3);
      } else if (event.route === 'patchApply') {
        const rateUg = extras.releaseRateUGPerDay;
        const wear = wearHours(event, events);
        const F = factor;
        if (rateUg > 0) {
          const rate = (rateUg / 24 / 1000) * F;
          fn = (t) => {
            const tau = t - start;
            if (tau < 0) return 0;
            if (tau <= wear) return (rate / k3) * (1 - Math.exp(-k3 * tau));
            const at = (rate / k3) * (1 - Math.exp(-k3 * wear));
            return at * Math.exp(-k3 * (tau - wear));
          };
          life = wear + 13.816 / k3;
        }
      }
      if (fn && event.route !== 'patchApply') life = 13.816 / Math.min(k3, 0.005);
    } else if (event.route === 'injection' && E2_DEPOT[ester]) {
      const d = E2_DEPOT[ester];
      const F = d.ff * factor;
      const k3 = E2_K3_INJ;
      fn = (t) => {
        const tau = t - start;
        if (tau < 0) return 0;
        const fast = dose * d.frac;
        const slow = dose * (1 - d.frac);
        if (d.k2 > 0) {
          return a3(tau, fast, F, d.k1f, d.k2, k3) + a3(tau, slow, F, d.k1s, d.k2, k3);
        }
        return a2(tau, fast, F, d.k1f, k3) + a2(tau, slow, F, d.k1s, k3);
      };
      const slowK = d.k1s > 0 ? d.k1s : d.k1f;
      life = 13.816 / Math.min(slowK, k3);
    } else if (event.route === 'oral') {
      const k1 = ester === 'EV' ? ORAL_K_EV : ORAL_K_E2;
      const k2 = ester === 'EV' ? 0 : ORAL_K_E1;
      const F = ORAL_BIO * factor;
      fn = (t) => (k2 > 0 ? a3(t - start, dose, F, k1, k2, E2_K3) : a2(t - start, dose, F, k1, E2_K3));
      life = 13.816 / (k2 > 0 ? Math.min(k2, E2_K3) : Math.min(k1, E2_K3));
    } else if (event.route === 'sublingual') {
      const theta = slTheta(extras);
      const kSlow = ester === 'EV' ? ORAL_K_EV : ORAL_K_E2;
      const k2fast = (ester === 'EV' ? 0.07 : 0);
      const k2slow = ester === 'EV' ? 0 : ORAL_K_E1;
      const Ffast = factor;
      const Fslow = ORAL_BIO * factor;
      fn = (t) => {
        const tau = t - start;
        if (tau < 0) return 0;
        const fast = k2fast > 0
          ? a3(tau, dose * theta, Ffast, SL_K, k2fast, E2_K3)
          : a2(tau, dose * theta, Ffast, SL_K, E2_K3);
        const slow = k2slow > 0
          ? a3(tau, dose * (1 - theta), Fslow, kSlow, k2slow, E2_K3)
          : a2(tau, dose * (1 - theta), Fslow, kSlow, E2_K3);
        return fast + slow;
      };
      life = 13.816 / Math.min(kSlow, E2_K3);
    } else if (event.route === 'gel') {
      const F = GEL_F[siteIndex(extras)] * factor;
      fn = (t) => a2(t - start, dose, F, GEL_K, E2_K3);
      life = 13.816 / GEL_K;
    } else if (event.route === 'patchApply') {
      const wear = wearHours(event, events);
      const rateUg = extras.releaseRateUGPerDay;
      const F = factor;
      if (rateUg > 0) {
        const rate = (rateUg / 24 / 1000) * F;
        fn = (t) => {
          const tau = t - start;
          if (tau < 0) return 0;
          if (tau <= wear) return (rate / E2_K3) * (1 - Math.exp(-E2_K3 * tau));
          const at = (rate / E2_K3) * (1 - Math.exp(-E2_K3 * wear));
          return at * Math.exp(-E2_K3 * (tau - wear));
        };
      } else if (dose > 0) {
        fn = (t) => {
          const tau = t - start;
          if (tau < 0) return 0;
          const amt = a2(Math.min(tau, wear), dose, F, 0.0075, E2_K3);
          if (tau <= wear) return amt;
          return a2(wear, dose, F, 0.0075, E2_K3) * Math.exp(-E2_K3 * (tau - wear));
        };
      }
      life = wear + 13.816 / E2_K3;
    }

    if (!fn) return null;
    return { fn, hormone, start, life };
  }

  function labToSeries(lab) {
    const unit = lab.unit;
    const v = Number(lab.concValue);
    if (!Number.isFinite(v)) return null;
    if (unit === 'pg/ml') return { series: 'e2', value: v };
    if (unit === 'pmol/l') return { series: 'e2', value: v / 3.671 };
    if (unit === 'ng/dl') return { series: 't', value: v };
    if (unit === 'nmol/l') return { series: 't', value: v * 28.842 };
    return null;
  }

  // 只算窗口内的曲线，步长约 1 小时，每次用药后再补几个点，避免峰被拉成直线。
  function simulate(events, weightKg, fromH, toH) {
    const kg = Number(weightKg) > 0 ? Number(weightKg) : 60;
    const compiled = [];
    for (const event of events || []) {
      const model = compile(event, events);
      if (model) compiled.push(model);
    }
    const times = [];
    if (toH > fromH) {
      const step = Math.max(0.5, (toH - fromH) / 800);
      for (let t = fromH; t <= toH; t += step) times.push(t);
      if (times[times.length - 1] !== toH) times.push(toH);
    }
    for (const model of compiled) {
      for (const off of [0.25, 0.5, 1, 2, 4, 8, 12, 24]) {
        const t = model.start + off;
        if (t >= fromH && t <= toH) times.push(t);
      }
    }
    times.sort((a, b) => a - b);
    const uniq = [];
    for (const t of times) {
      if (!uniq.length || t - uniq[uniq.length - 1] > 1e-6) uniq.push(t);
    }

    const vdE2 = 2 * kg * 1000;
    const vdCpa = 14 * kg * 1000;
    const vdT = 1 * kg * 1000;
    const e2 = [];
    const t = [];
    const cpa = [];
    for (const hour of uniq) {
      let aE2 = 0; let aT = 0; let aC = 0;
      for (const model of compiled) {
        if (hour < model.start || hour - model.start > model.life) continue;
        const amt = model.fn(hour);
        if (model.hormone === 'cpa') aC += amt;
        else if (model.hormone === 't') aT += amt;
        else aE2 += amt;
      }
      e2.push((aE2 * 1e9) / vdE2);
      cpa.push((aC * 1e6) / vdCpa);
      t.push((aT * 1e8) / vdT);
    }
    return { timeH: uniq, e2, t, cpa };
  }

  window.PK = { simulate, labToSeries, thetaFromHold, holdFromTheta };
})();
