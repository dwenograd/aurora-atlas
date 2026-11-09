/* Aurora Atlas: visual effects (WebGL aurora + cloud layer, aurora particles, welcome sky, solar wind) */
'use strict';
(function (AA) {
  const U = AA.U;
  const FX = (AA.FX = {});

  const NOISE = `
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return v; }
  `;
  const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

  // Map overlay, painted bottom to top:
  //  1. Best sky: clear sky x dark sky x aurora reach x night darkness, from a dark veil through teal
  //     and green to gold, with sparkles on the golden ground.
  //  2. Clouds: forecast cloud cover as drifting fog, with stars twinkling wherever it's clear.
  //  3. Aurora: NOAA's OVATION probability as moving curtains.
  const FRAG_MAP = `
    precision highp float;
    uniform vec2 uRes; uniform vec4 uView; uniform float uPpd; uniform vec2 uAnchor; uniform float uDpr; uniform float uTime;
    uniform sampler2D uOv; uniform float uAurora;
    uniform sampler2D uCloud; uniform vec4 uCBox; uniform vec2 uCN; uniform float uCMix; uniform float uClouds;
    uniform sampler2D uSite; uniform vec2 uSN; uniform float uBest; uniform float uBMode; uniform float uKp; uniform vec4 uDark; uniform vec2 uPole; uniform float uAssume;
    ${NOISE}
    // Smooth cubic B-spline sampling of the coarse cloud grid (4 bilinear taps), so it has no grid kinks
    vec4 cloudAt(vec2 cuv) {
      vec2 p = cuv * (uCN - 1.0);
      vec2 i = floor(p); vec2 f = p - i;
      vec2 f2 = f * f; vec2 f3 = f2 * f;
      vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
      vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
      vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
      vec2 w3 = f3 / 6.0;
      vec2 g0 = w0 + w1; vec2 g1 = w2 + w3;
      vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / uCN;
      vec2 h1 = (i + 1.0 + w3 / g1 + 0.5) / uCN;
      return g0.y * (g0.x * texture2D(uCloud, vec2(h0.x, h0.y)) + g1.x * texture2D(uCloud, vec2(h1.x, h0.y)))
           + g1.y * (g0.x * texture2D(uCloud, vec2(h0.x, h1.y)) + g1.x * texture2D(uCloud, vec2(h1.x, h1.y)));
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float lon = mix(uView.x, uView.y, uv.x);
      float my = mix(uView.z, uView.w, uv.y);
      float lat = degrees(2.0 * atan(exp(my)) - 1.5707963);
      vec2 g = (vec2(lon, degrees(my)) - uAnchor) * uPpd;
      vec3 col = vec3(0.0); float alpha = 0.0;

      if (uClouds > 0.002 || uBest > 0.002) {
        float cu = (lon - uCBox.x) / (uCBox.z - uCBox.x);
        float cv = (lat - uCBox.y) / (uCBox.w - uCBox.y);
        if (cu > 0.0 && cu < 1.0 && cv > 0.0 && cv < 1.0) {
          vec4 c = cloudAt(vec2(cu, cv));
          float cc = mix(c.r, c.g, uCMix);
          float low = mix(c.b, c.a, uCMix);
          float edge = smoothstep(0.0, 0.05, cu) * smoothstep(0.0, 0.05, 1.0 - cu) * smoothstep(0.0, 0.05, cv) * smoothstep(0.0, 0.05, 1.0 - cv);

          if (uBest > 0.002) {
            vec2 sc = vec2((cu * (uSN.x - 1.0) + 0.5) / uSN.x, (cv * (uSN.y - 1.0) + 0.5) / uSN.y);
            float site = texture2D(uSite, sc).r;
            float clar = mix(1.0 - cc, 1.0, uAssume);
            float rl = radians(lat);
            float sml = sin(rl) * sin(uPole.x) + cos(rl) * cos(uPole.x) * cos(radians(lon) - uPole.y);
            float ml = degrees(asin(clamp(sml, -1.0, 1.0)));
            float need = (85.0 - abs(ml)) / 5.0;
            float aur = 0.03 + 0.97 * smoothstep(-1.5, 1.0, uKp - need);
            float s = uBMode < 0.5 ? aur * clar * uDark.x * uDark.z * (1.0 - 0.45 * (1.0 - site)) : clar * uDark.y * uDark.w * site;
            float k = uBest * edge;
            float veil = (1.0 - smoothstep(0.1, 0.38, s)) * 0.5 * k;
            vec3 bc = mix(vec3(0.10, 0.50, 0.58), vec3(0.36, 0.92, 0.6), smoothstep(0.3, 0.56, s));
            bc = mix(bc, vec3(1.0, 0.87, 0.5), smoothstep(0.56, 0.8, s));
            float ba = smoothstep(0.2, 0.6, s) * mix(0.55, 0.82, smoothstep(0.56, 0.85, s)) * k;
            col = vec3(0.012, 0.02, 0.04) * veil; alpha = veil;
            col = bc * ba + col * (1.0 - ba); alpha = ba + alpha * (1.0 - ba);
            if (s > 0.6) {
              vec2 sp = gl_FragCoord.xy / (9.0 * uDpr);
              vec2 cell = floor(sp); vec2 f = fract(sp);
              float h = hash(cell + 7.3);
              if (h > 0.9) {
                vec2 pos = vec2(hash(cell + 2.1), hash(cell + 5.9)) * 0.6 + 0.2;
                float d = length((f - pos) * 9.0);
                float tw = 0.5 + 0.5 * sin(uTime * (1.3 + 2.0 * hash(cell + 4.4)) + h * 50.0);
                float spk = smoothstep(1.7, 0.0, d) * tw * smoothstep(0.6, 0.9, s) * k;
                col += vec3(1.0, 0.92, 0.66) * spk; alpha = max(alpha, spk);
              }
            }
          }

          if (uClouds > 0.002) {
            vec2 q = g / 230.0 + vec2(uTime * 0.018, uTime * 0.006);
            float n1 = fbm(q);
            float n2 = fbm(q * 2.6 + vec2(3.1, 1.7) - uTime * 0.01);
            float dens = smoothstep(0.04, 0.96, cc);
            float a = dens * (0.42 + 0.58 * mix(n1, n2, 0.4));
            a = clamp(a * (0.6 + 0.3 * low), 0.0, 0.84) * uClouds * edge;
            vec3 fog = mix(vec3(0.30, 0.35, 0.46), vec3(0.66, 0.71, 0.82), n2);
            col = fog * a + col * (1.0 - a); alpha = a + alpha * (1.0 - a);
            float clear = (1.0 - smoothstep(0.12, 0.42, cc)) * edge * uClouds;
            if (clear > 0.01) {
              vec2 sp = gl_FragCoord.xy / (7.0 * uDpr);
              vec2 cell = floor(sp); vec2 f = fract(sp);
              float h = hash(cell);
              if (h > 0.972) {
                vec2 pos = vec2(hash(cell + 3.7), hash(cell + 9.2)) * 0.6 + 0.2;
                float d = length((f - pos) * 7.0);
                float tw = 0.5 + 0.5 * sin(uTime * (1.1 + 2.6 * hash(cell + 1.1)) + h * 80.0);
                float s2 = smoothstep(1.3, 0.0, d) * tw * clear * (0.45 + 0.55 * hash(cell + 5.5));
                col += vec3(0.86, 0.91, 1.0) * s2; alpha = max(alpha, s2);
              }
            }
          }
        }
      }

      if (uAurora > 0.002) {
        float lonE = mod(lon, 360.0);
        float sway = sin(g.y / 90.0 + uTime * 0.21) * 0.5 + sin(g.x / 140.0 - uTime * 0.13) * 0.5;
        vec2 tc = vec2((lonE + 0.5 + sway * 0.55) / 361.0, (lat + 90.5) / 181.0);
        float p = texture2D(uOv, tc).r * 2.55;
        if (p > 0.006) {
          float I = smoothstep(0.0, 0.42, p);
          float rays = fbm(vec2(g.x / 30.0 + uTime * 0.09, g.y / 240.0 - uTime * 0.03));
          rays = smoothstep(0.22, 0.85, rays);
          float shimmer = noise(vec2(g.x / 8.0 + uTime * 0.9, g.y / 40.0 + uTime * 0.3));
          float breathe = 0.78 + 0.22 * sin(uTime * 0.55 + g.x / 300.0);
          float a = I * (0.3 + 0.7 * rays) * (0.82 + 0.18 * shimmer) * breathe;
          vec3 teal = vec3(0.18, 0.82, 0.78);
          vec3 green = vec3(0.36, 1.0, 0.6);
          vec3 violet = vec3(0.64, 0.48, 1.0);
          vec3 rose = vec3(1.0, 0.38, 0.58);
          vec3 c = mix(teal, green, smoothstep(0.02, 0.14, p));
          c = mix(c, violet, smoothstep(0.32, 0.72, p) * (0.35 + 0.65 * rays));
          c = mix(c, rose, smoothstep(0.62, 0.95, p) * shimmer * 0.8);
          a = clamp(a * 0.92, 0.0, 0.9) * uAurora;
          col = c * a + col * (1.0 - a);
          alpha = a + alpha * (1.0 - a);
        }
      }
      gl_FragColor = vec4(col, alpha);
    }
  `;

  function compile(gl, vsrc, fsrc) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function triangle(gl) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return buf;
  }

  // ---------- Map layer ----------
  FX.createMapLayer = (map) => {
    const pane = map.createPane('fxPane');
    pane.style.zIndex = 300;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    pane.appendChild(canvas);
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { console.warn('WebGL is not available: the aurora, cloud and best-sky layers are off.'); return null; }
    let prog, buf, loc, u, ovTex, cloudTex, siteTex;
    const st = {
      aurora: 0, auroraTarget: 1, clouds: 0, cloudsTarget: 1, best: 0, bestTarget: 1,
      hasOv: false, grid: null, h0: -1, cmix: 0, anchor: null, anchorZoom: null, lost: false, ovData: null,
      site: null, bp: { kp: 0, mode: 1, dark: [0, 0, 1, 1] },
    };
    const UNIFORMS = ['uRes', 'uView', 'uPpd', 'uAnchor', 'uDpr', 'uTime', 'uOv', 'uAurora', 'uCloud', 'uCBox', 'uCN', 'uCMix', 'uClouds', 'uSite', 'uSN', 'uBest', 'uBMode', 'uKp', 'uDark', 'uPole', 'uAssume'];
    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    function init() {
      prog = compile(gl, VERT, FRAG_MAP);
      buf = triangle(gl);
      loc = gl.getAttribLocation(prog, 'p');
      u = {};
      for (const n of UNIFORMS) u[n] = gl.getUniformLocation(prog, n);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      ovTex = mkTex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      cloudTex = mkTex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      siteTex = mkTex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([128]));
      if (st.ovData) uploadOv(st.ovData);
      if (st.site) uploadSite(st.site);
      st.h0 = -1;
    }
    try { init(); } catch (e) { console.error('Map shader failed', e); return null; }
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); st.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { st.lost = false; try { init(); } catch (e) { console.error(e); } });

    function uploadOv(data) {
      gl.bindTexture(gl.TEXTURE_2D, ovTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 361, 181, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    }
    function uploadSite(s) {
      gl.bindTexture(gl.TEXTURE_2D, siteTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, s.W, s.H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, s.data);
    }
    function setOvation(grid) {
      const W = 361, data = new Uint8Array(W * 181);
      for (let j = 0; j < 181; j++) {
        for (let i = 0; i < 360; i++) data[j * W + i] = grid[j * 360 + i];
        data[j * W + 360] = grid[j * 360];
      }
      st.ovData = data;
      if (!st.lost) uploadOv(data);
      st.hasOv = true;
    }
    function setSite(s) { st.site = s; if (!st.lost) uploadSite(s); }
    function setCloudGrid(g) { st.grid = g; st.h0 = -1; }
    function setCloudTime(t) {
      const g = st.grid;
      if (!g || st.lost) return;
      const ht = U.clamp((t - g.t[0]) / U.HOUR, 0, g.t.length - 1);
      const h0 = Math.floor(ht), h1 = Math.min(g.t.length - 1, h0 + 1);
      st.cmix = ht - h0;
      if (h0 !== st.h0) {
        const n = g.nx * g.ny, data = new Uint8Array(n * 4);
        for (let k = 0; k < n; k++) {
          data[k * 4] = Math.round(g.total[h0 * n + k] * 2.55);
          data[k * 4 + 1] = Math.round(g.total[h1 * n + k] * 2.55);
          data[k * 4 + 2] = Math.round(g.low[h0 * n + k] * 2.55);
          data[k * 4 + 3] = Math.round(g.low[h1 * n + k] * 2.55);
        }
        gl.bindTexture(gl.TEXTURE_2D, cloudTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, g.nx, g.ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        st.h0 = h0;
      }
    }
    function render(timeSec) {
      if (st.lost) return;
      const size = map.getSize();
      const scale = Math.min(window.devicePixelRatio || 1, 1) * (size.x * size.y > 2.4e6 ? 0.75 : 1);
      const W = Math.max(1, Math.round(size.x * scale)), H = Math.max(1, Math.round(size.y * scale));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
        canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
      }
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      st.aurora += (st.auroraTarget - st.aurora) * 0.07;
      st.clouds += (st.cloudsTarget - st.clouds) * 0.07;
      st.best += (st.bestTarget - st.best) * 0.07;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const g = st.grid;
      const showA = st.hasOv && st.aurora > 0.004;
      const showC = !!g && st.clouds > 0.004;
      const showB = !!g && !!st.site && st.best > 0.004;
      if (!showA && !showC && !showB) return;
      const nw = map.containerPointToLatLng([0, 0]), se = map.containerPointToLatLng([size.x, size.y]);
      const west = nw.lng, east = se.lng;
      const north = U.clamp(nw.lat, -85.05, 85.05), south = U.clamp(se.lat, -85.05, 85.05);
      const z = map.getZoom();
      if (!st.anchor || st.anchorZoom !== z) { const c = map.getCenter(); st.anchor = [c.lng, U.deg(U.mercY(c.lat))]; st.anchorZoom = z; }
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform4f(u.uView, west, east, U.mercY(south), U.mercY(north));
      gl.uniform1f(u.uPpd, size.x / (east - west));
      gl.uniform2f(u.uAnchor, st.anchor[0], st.anchor[1]);
      gl.uniform1f(u.uDpr, scale);
      gl.uniform1f(u.uTime, timeSec % 1800);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ovTex); gl.uniform1i(u.uOv, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cloudTex); gl.uniform1i(u.uCloud, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, siteTex); gl.uniform1i(u.uSite, 2);
      gl.uniform1f(u.uAurora, showA ? st.aurora : 0);
      gl.uniform1f(u.uClouds, showC ? st.clouds : 0);
      gl.uniform1f(u.uBest, showB ? st.best : 0);
      if (g) { gl.uniform4f(u.uCBox, g.west, g.south, g.east, g.north); gl.uniform2f(u.uCN, g.nx, g.ny); gl.uniform1f(u.uCMix, st.cmix); }
      if (st.site) gl.uniform2f(u.uSN, st.site.W, st.site.H);
      const bp = st.bp;
      gl.uniform1f(u.uBMode, bp.mode);
      gl.uniform1f(u.uKp, bp.kp);
      gl.uniform4f(u.uDark, bp.dark[0], bp.dark[1], bp.dark[2], bp.dark[3]);
      gl.uniform2f(u.uPole, U.rad(AA.Sky.POLE.lat), U.rad(AA.Sky.POLE.lon));
      gl.uniform1f(u.uAssume, bp.assume || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return {
      setOvation, setCloudGrid, setCloudTime, setSite, render,
      setAurora: (v) => { st.auroraTarget = v; },
      setClouds: (v) => { st.cloudsTarget = v; },
      setBest: (v) => { st.bestTarget = v; },
      setBestParams: (p) => { st.bp = p; },
      get busy() { return Math.abs(st.aurora - st.auroraTarget) > 0.01 || Math.abs(st.clouds - st.cloudsTarget) > 0.01 || Math.abs(st.best - st.bestTarget) > 0.01; },
    };
  };

  // ---------- Aurora particles: rising ray sparks wherever NOAA's oval is ----------
  FX.createParticles = (map) => {
    const pane = map.createPane('particlePane');
    pane.style.zIndex = 320;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    pane.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const mk = (rgb) => {
      const c = document.createElement('canvas');
      c.width = 24; c.height = 96;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 96, 0, 0);
      grd.addColorStop(0, `rgba(${rgb},0)`);
      grd.addColorStop(0.07, `rgba(${rgb},1)`);
      grd.addColorStop(0.32, `rgba(${rgb},0.5)`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.shadowColor = `rgba(${rgb},0.95)`;
      g.shadowBlur = 7;
      g.fillStyle = grd;
      g.fillRect(10.5, 4, 3, 88);
      return c;
    };
    const sprites = { teal: mk('80,230,215'), green: mk('120,255,185'), violet: mk('185,155,255'), rose: mk('255,140,180') };
    const P = [];
    let amount = 1;
    function pick(p) {
      const r = Math.random();
      if (p > 45 && r < 0.3) return sprites.rose;
      if (p > 25 && r < 0.45) return sprites.violet;
      return r < 0.25 ? sprites.teal : sprites.green;
    }
    function step(dt) {
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(size.x * dpr), H = Math.round(size.y * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px'; }
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      if (!AA.D.ov || amount <= 0.01) { P.length = 0; return; }
      const target = Math.round(240 * amount);
      let tries = 0;
      while (P.length < target && tries++ < 36) {
        const x = Math.random() * size.x, y = Math.random() * size.y;
        const ll = map.containerPointToLatLng([x, y]);
        const p = AA.Sky.ovAt(ll.lat, ll.lng) || 0;
        if (p < 4 || Math.random() > Math.pow(Math.min(1, p / 55), 0.85)) continue;
        P.push({ lat: ll.lat, lon: ll.lng, age: 0, life: 2.4 + Math.random() * 4.2, len: 16 + Math.random() * 38 * Math.min(1, 0.35 + p / 40), img: pick(p), dx: 0, vx: 6 + Math.random() * 14, rise: 3 + Math.random() * 9 });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = P.length - 1; i >= 0; i--) {
        const q = P[i];
        q.age += dt;
        q.dx += q.vx * dt;
        if (q.age >= q.life) { P.splice(i, 1); continue; }
        const pt = map.latLngToContainerPoint([q.lat, q.lon]);
        const x = pt.x + q.dx, y = pt.y - q.rise * q.age;
        if (x < -20 || y < -80 || x > size.x + 20 || y > size.y + 20) continue;
        const env = Math.sin((Math.PI * q.age) / q.life);
        ctx.globalAlpha = env * env * 0.8 * amount;
        ctx.drawImage(q.img, x - 6, y - q.len, 12, q.len * 1.1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    return { step, setAmount: (v) => { amount = v; }, clear: () => { P.length = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); } };
  };

  // ---------- Welcome sky: aurora over mountains and a still lake ----------
  const FRAG_WELCOME = `
    precision highp float;
    uniform vec2 uRes; uniform float uTime;
    ${NOISE}
    float fbm5(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(11.7, 5.3); a *= 0.5; } return v; }
    vec3 aurora(vec2 uv, float t) {
      vec3 col = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float x = uv.x;
        float base = 0.43 + 0.1 * fk + 0.07 * sin(x * 1.6 + t * 0.06 + fk * 2.3) + 0.035 * sin(x * 4.1 - t * 0.09 + fk);
        float y = uv.y - base;
        float rays = fbm5(vec2(x * 9.0 + fk * 7.0 + t * 0.05, t * 0.05 + fk * 3.0));
        rays = smoothstep(0.28, 0.9, rays);
        float curtain = smoothstep(-0.012, 0.012, y) * exp(-max(y, 0.0) * (3.0 + 1.6 * fk));
        float fold = 0.55 + 0.45 * sin(x * 6.0 + t * 0.22 + fk * 1.9 + 2.5 * fbm(vec2(x * 1.5, t * 0.07 + fk)));
        float I = curtain * (0.22 + rays) * fold * (1.0 - 0.3 * fk);
        vec3 green = vec3(0.24, 1.0, 0.58);
        vec3 teal = vec3(0.14, 0.78, 0.8);
        vec3 violet = vec3(0.62, 0.36, 1.0);
        vec3 c = mix(mix(green, teal, 0.35 * fk), violet, smoothstep(0.035, 0.26, y));
        col += c * I;
      }
      return col;
    }
    float stars(vec2 uv, float t) {
      vec2 sp = uv * uRes.y / 2.2;
      vec2 cell = floor(sp); vec2 f = fract(sp);
      float h = hash(cell);
      if (h < 0.982) return 0.0;
      vec2 o = vec2(hash(cell + 1.7), hash(cell + 4.3)) * 0.6 + 0.2;
      float d = length(f - o);
      float tw = 0.6 + 0.4 * sin(t * (0.7 + 2.0 * hash(cell + 2.1)) + h * 90.0);
      return smoothstep(0.42, 0.0, d) * tw * (0.3 + 0.7 * hash(cell + 8.8));
    }
    vec3 skyAt(vec2 uv, float t) {
      vec3 c = mix(vec3(0.005, 0.009, 0.024), vec3(0.02, 0.034, 0.075), smoothstep(0.15, 1.0, uv.y));
      c += vec3(0.82, 0.88, 1.0) * stars(uv, t) * smoothstep(0.2, 0.5, uv.y);
      c += aurora(uv, t) * 1.3;
      return c;
    }
    float coneH(float x, float px) { return 0.43 - abs(x - px) * 0.52; }
    float ridgeH(float x) { return 0.215 + 0.06 * fbm(vec2(x * 1.3 + 4.0, 0.5)) + 0.02 * sin(x * 3.1); }
    float treeH(float x, float water) {
      float tx = x * 46.0; float ti = floor(tx); float tf = fract(tx);
      float th = (0.016 + 0.045 * hash(vec2(ti, 3.1))) * step(0.16, hash(vec2(ti, 7.7)));
      return water + 0.012 + th * max(0.0, 1.0 - abs(tf - 0.5) * 2.2) + 0.004 * noise(vec2(x * 120.0, 1.0));
    }
    vec3 scene(vec2 uv, float t, float aspect, float water) {
      float px = aspect * 0.72;
      float cone = coneH(uv.x, px) + 0.01 * fbm(vec2(uv.x * 9.0, 2.0));
      float ridge = ridgeH(uv.x);
      float mount = max(cone, ridge);
      float tree = treeH(uv.x, water);
      if (uv.y < tree) return vec3(0.003, 0.005, 0.009);
      if (uv.y < mount) {
        vec3 m = vec3(0.017, 0.025, 0.045);
        float rim = smoothstep(mount - 0.02, mount, uv.y);
        m += vec3(0.05, 0.12, 0.1) * rim * 0.35;
        if (cone > ridge) {
          float capLine = 0.43 - 0.085 + 0.02 * noise(vec2(uv.x * 30.0, 4.0));
          float cap = smoothstep(capLine, capLine + 0.012, uv.y) * (0.55 + 0.45 * noise(uv * 60.0));
          m = mix(m, vec3(0.13, 0.19, 0.22), cap * 0.75);
        }
        return m;
      }
      return skyAt(uv, t);
    }
    void main() {
      float t = uTime;
      float aspect = uRes.x / uRes.y;
      vec2 uv = gl_FragCoord.xy / uRes.y;
      float water = 0.165;
      vec3 col;
      if (uv.y > water) {
        col = scene(uv, t, aspect, water);
      } else {
        float ry = 2.0 * water - uv.y;
        float depth = (water - uv.y) / water;
        vec2 ruv = vec2(uv.x + (0.003 + 0.004 * depth) * sin(uv.y * 170.0 + t * 1.5) + 0.002 * sin(uv.y * 420.0 - t * 2.2), ry);
        col = scene(ruv, t, aspect, water) * (0.42 - 0.22 * depth) + vec3(0.003, 0.007, 0.014);
        col += vec3(0.05, 0.12, 0.1) * pow(noise(vec2(uv.x * 28.0, uv.y * 380.0 + t * 0.8)), 7.0) * 0.5;
      }
      vec2 q = gl_FragCoord.xy / uRes;
      col *= 0.72 + 0.28 * smoothstep(1.25, 0.2, length(q - vec2(0.55, 0.62)));
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  FX.createWelcomeSky = (canvas) => {
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, alpha: false });
    if (!gl) { canvas.style.background = 'radial-gradient(ellipse at 60% 30%, #12304a, #02040a 70%)'; return { render() {}, destroy() {} }; }
    let prog;
    try { prog = compile(gl, VERT, FRAG_WELCOME); } catch (e) { console.error('Welcome shader failed', e); return { render() {}, destroy() {} }; }
    const buf = triangle(gl);
    const loc = gl.getAttribLocation(prog, 'p');
    const uRes = gl.getUniformLocation(prog, 'uRes'), uTime = gl.getUniformLocation(prog, 'uTime');
    let last = 0;
    return {
      render(tSec) {
        if (tSec - last < 1 / 40) return; // ~40 fps is plenty for a slow sky
        last = tSec;
        const r = canvas.getBoundingClientRect();
        const scale = Math.min(window.devicePixelRatio || 1, 1.25) * 0.7;
        const W = Math.max(1, Math.round(r.width * scale)), H = Math.max(1, Math.round(r.height * scale));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        gl.viewport(0, 0, W, H);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(uRes, W, H);
        gl.uniform1f(uTime, (tSec % 3600) + 40);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); },
    };
  };

  // ---------- Solar wind: particles stream from the Sun into Earth's magnetosphere ----------
  FX.createSolarWind = (canvas) => {
    const P = [];
    const flashes = [];
    const s = { v: 420, n: 5, bz: 0, kp: 2 };
    function set(v) { Object.assign(s, v); }
    function step(dt) {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const { ctx, w, h } = U.fitCanvas(canvas, 2);
      ctx.clearRect(0, 0, w, h);
      const ex = w * 0.8, ey = h * 0.5, er = Math.min(h * 0.13, 19);
      const south = U.clamp(-(s.bz ?? 0) / 12, 0, 1);
      const speed = 40 + U.clamp(((s.v ?? 400) - 250) / 650, 0, 1) * 190;
      const target = Math.round(30 + U.clamp(s.n ?? 5, 0.5, 40) * 5);
      // sun glow
      const sg = ctx.createRadialGradient(-h * 0.25, ey, 0, -h * 0.25, ey, h * 1.1);
      sg.addColorStop(0, 'rgba(255,200,120,0.55)');
      sg.addColorStop(0.35, 'rgba(255,150,70,0.16)');
      sg.addColorStop(1, 'rgba(255,120,50,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);
      // magnetosphere: bow shock + tail lines
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(130,170,255,${0.16 + 0.12 * south})`;
      ctx.beginPath();
      ctx.ellipse(ex + er * 0.3, ey, er * 2.7, h * 0.44, 0, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(130,170,255,0.08)';
      for (const k of [-1, 1]) {
        for (const off of [1.5, 2.3]) {
          ctx.beginPath();
          ctx.moveTo(ex - er * 0.2, ey + k * er * 0.9);
          ctx.bezierCurveTo(ex + er * 1.5, ey + k * er * off * 1.6, ex + er * 3, ey + k * er * off * 0.9, w + 10, ey + k * er * off * 0.7);
          ctx.stroke();
        }
      }
      // particles
      while (P.length < target) P.push({ x: -Math.random() * w * 0.2, y: Math.random() * h, vx: speed * (0.8 + Math.random() * 0.4), cap: Math.random() < 0.18 * south, k: Math.random() < 0.5 ? -1 : 1 });
      ctx.lineCap = 'round';
      for (let i = P.length - 1; i >= 0; i--) {
        const q = P[i];
        const dx = q.x - ex, dy = q.y - ey, d = Math.hypot(dx, dy);
        let vy = 0;
        if (q.cap && dx > -er * 3.5) {
          const tx = ex + er * 0.15, ty = ey + q.k * er * 0.82;
          vy = (ty - q.y) * 2.6;
          q.vx = Math.max(25, q.vx * (1 - dt * 1.4));
          if (Math.hypot(q.x - tx, q.y - ty) < er * 0.35) { flashes.push({ x: tx, y: ty, a: 1 }); P.splice(i, 1); continue; }
        } else if (dx > -er * 3.2 && d < er * 3.2) {
          vy = (dy >= 0 ? 1 : -1) * (er * 3.2 - d) * 4.5;
        }
        q.x += q.vx * dt;
        q.y += vy * dt;
        if (q.x > w + 10 || q.y < -10 || q.y > h + 10) { P.splice(i, 1); continue; }
        const len = Math.min(18, q.vx * 0.05);
        const c = q.cap ? `rgba(255,${130 + 60 * (1 - south)},190,0.9)` : `rgba(${170 + 60 * (1 - south)},${210 - 40 * south},255,0.7)`;
        ctx.strokeStyle = c;
        ctx.lineWidth = q.cap ? 1.6 : 1.1;
        ctx.beginPath();
        ctx.moveTo(q.x - len, q.y - vy * 0.02);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      // Earth
      const eg = ctx.createRadialGradient(ex - er * 0.4, ey - er * 0.4, er * 0.1, ex, ey, er);
      eg.addColorStop(0, '#3d7bd6');
      eg.addColorStop(0.7, '#173b78');
      eg.addColorStop(1, '#0b1d3d');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      // auroral ovals, brighter with Kp
      const glow = 0.25 + U.clamp((s.kp ?? 2) / 9, 0, 1) * 0.75;
      for (const k of [-1, 1]) {
        ctx.save();
        ctx.shadowColor = 'rgba(98,240,166,0.9)';
        ctx.shadowBlur = 10 * glow;
        ctx.strokeStyle = `rgba(110,255,180,${0.35 + 0.6 * glow})`;
        ctx.lineWidth = 2 + glow * 2;
        ctx.beginPath();
        ctx.ellipse(ex, ey + k * er * 0.78, er * 0.42, er * 0.13, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.a -= dt * 2.2;
        if (f.a <= 0) { flashes.splice(i, 1); continue; }
        const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, er * 0.8);
        fg.addColorStop(0, `rgba(160,255,200,${0.7 * f.a})`);
        fg.addColorStop(1, 'rgba(160,255,200,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(f.x - er, f.y - er, er * 2, er * 2);
      }
    }
    return { set, step };
  };
})(window.AA);
