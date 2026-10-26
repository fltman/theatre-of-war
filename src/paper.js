// Slitet papper: genererar texturer en gång vid start och lägger dem i CSS-variabler.
//   --tex-worn       dossiern, lapparna och korten (krämvitt, fibrer, stockfläckar, vattenränder, kors-veck, mörka kanter)
//   --tex-newsprint  tidningarna (gulnat, ojämnt, tryckfärgsfläckar)
//   --edge-mask      ojämna, nötta kanter med ett hundöra (mask-image, 100 % × 100 %)
//   --ink-mask       ojämn stämpelfärg (mask-image för stämplar)

let seed = 1952;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function sheet({ w = 1024, h = 1280, base, tone, edge, fibres = 2200, fox = 70, folds = [], stains = 3, ring = true }) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // storskaliga toner (ojämn åldring)
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = rnd() * h, r = 80 + rnd() * 380;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.03 + rnd() * 0.08;
    gr.addColorStop(0, `rgba(${tone},${a})`); gr.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // vattenränder: oregelbundna cirklar med mörkare kant
  for (let i = 0; i < stains; i++) {
    const cx = rnd() * w, cy = rnd() * h, R = 60 + rnd() * 170;
    g.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const rr = R * (1 + Math.sin(a * 3 + i) * 0.08 + Math.sin(a * 7 + i * 2) * 0.05 + (rnd() - 0.5) * 0.03);
      k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = `rgba(${tone},0.05)`; g.fill();
    g.strokeStyle = `rgba(${tone},0.16)`; g.lineWidth = 2 + rnd() * 3; g.stroke();
  }
  // kafferinge (bara på dossiern)
  if (ring) {
    const cx = w * (0.62 + rnd() * 0.25), cy = h * (0.72 + rnd() * 0.2), R = 95 + rnd() * 30;
    for (let k = 0; k < 3; k++) {
      g.beginPath(); g.ellipse(cx + k * 2, cy, R - k * 2, R * 0.97 - k * 2, 0.3, 0.5 + k * 0.6, Math.PI * 2 - 0.4);
      g.strokeStyle = `rgba(120,70,25,${0.22 - k * 0.06})`; g.lineWidth = 5 - k; g.stroke();
    }
  }
  // fibrer
  for (let i = 0; i < fibres; i++) {
    const x = rnd() * w, y = rnd() * h, len = 4 + rnd() * 18, a = rnd() * Math.PI;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * 4, y + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * 4, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.strokeStyle = rnd() < 0.5 ? `rgba(255,252,240,${0.12 + rnd() * 0.15})` : `rgba(${tone},${0.06 + rnd() * 0.1})`;
    g.lineWidth = 0.5 + rnd(); g.stroke();
  }
  // stockfläckar: små bruna prickar i klungor
  for (let i = 0; i < fox; i++) {
    const cx = rnd() * w, cy = rnd() * h, n = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 30, y = cy + (rnd() - 0.5) * 30, r = 0.8 + rnd() * 3.2;
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2);
      gr.addColorStop(0, `rgba(130,80,35,${0.25 + rnd() * 0.3})`); gr.addColorStop(1, 'rgba(130,80,35,0)');
      g.fillStyle = gr; g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    }
  }
  // vikveck: mörk linje + ljus kant, lätt vågig
  for (const f of folds) {
    const vertical = f.dir === 'v', pos = f.at * (vertical ? w : h), L = vertical ? h : w;
    for (const [off, col, lw] of [[-1.5, `rgba(${tone},0.28)`, 2.5], [1.5, 'rgba(255,250,235,0.35)', 2]]) {
      g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const t = (k / 40) * L, wob = Math.sin(k * 0.7 + pos) * 1.5;
        const x = vertical ? pos + off + wob : t, y = vertical ? t : pos + off + wob;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    }
    const gr = vertical ? g.createLinearGradient(pos - 40, 0, pos + 40, 0) : g.createLinearGradient(0, pos - 40, 0, pos + 40);
    gr.addColorStop(0, `rgba(${tone},0)`); gr.addColorStop(0.5, `rgba(${tone},0.08)`); gr.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = gr; vertical ? g.fillRect(pos - 40, 0, 80, h) : g.fillRect(0, pos - 40, w, 80);
  }
  // nötning: ljusa skrapmärken
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w, y = rnd() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 12);
    g.strokeStyle = `rgba(255,255,245,${0.08 + rnd() * 0.1})`; g.lineWidth = 1 + rnd() * 3; g.stroke();
  }
  // mörka, ojämna kanter
  for (let i = 0; i < 4; i++) {
    const side = i;
    const gr = side === 0 ? g.createLinearGradient(0, 0, 0, 120) : side === 1 ? g.createLinearGradient(0, h, 0, h - 120) : side === 2 ? g.createLinearGradient(0, 0, 120, 0) : g.createLinearGradient(w, 0, w - 120, 0);
    gr.addColorStop(0, `rgba(${edge},0.45)`); gr.addColorStop(0.35, `rgba(${edge},0.12)`); gr.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 60; i++) {           // fläckig kantmörkning
    const onX = rnd() < 0.5, x = onX ? rnd() * w : (rnd() < 0.5 ? 0 : w), y = onX ? (rnd() < 0.5 ? 0 : h) : rnd() * h, r = 20 + rnd() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${edge},${0.12 + rnd() * 0.15})`); gr.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fint korn
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.86);
}

// Nötta kanter: små ojämnheter längs hela randen, några hack och ett hundöra uppe till höger.
function edgeMask() {
  const P = [];
  const jag = (a, b, n, axis) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const d = (rnd() - 0.5) * 3.2 + (rnd() < 0.04 ? -rnd() * 9 : 0);   // ibland ett hack
      if (axis === 'x') y += d; else x += d;
      P.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  };
  jag([3, 3], [955, 3], 90, 'x');
  P.push('997,45');                                    // hundörat
  jag([997, 45], [997, 997], 90, 'y');
  jag([997, 997], [3, 997], 90, 'x');
  jag([3, 997], [3, 3], 90, 'y');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'><polygon points='${P.join(' ')}' fill='white'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// Stämpelfärg: brus som slår ut fläckar ur stämpeln.
function inkMask() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='120'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.75'/></filter><rect width='240' height='120' filter='url(%23f)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`;
}

export function agePaper() {
  const root = document.documentElement.style;
  root.setProperty('--tex-worn', `url(${sheet({ base: '#e6d9b8', tone: '120,85,40', edge: '95,62,25', folds: [{ dir: 'v', at: 0.5 }, { dir: 'h', at: 0.36 }], stains: 3 })})`);
  root.setProperty('--tex-newsprint', `url(${sheet({ w: 1280, h: 960, base: '#e3d3ab', tone: '125,90,40', edge: '100,70,30', fibres: 3200, fox: 110, folds: [{ dir: 'h', at: 0.5 }], stains: 2, ring: false })})`);
  root.setProperty('--edge-mask', edgeMask());
  root.setProperty('--ink-mask', inkMask());
}
