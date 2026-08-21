/* Landing page */

const Landing = ({ tweaks, onCreateRoom }) => {
  const [name, setName] = React.useState('');
  const [recogStrokes, setRecogStrokes] = React.useState(0);
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);
  const lastRef = React.useRef(null);
  const [guesses, setGuesses] = React.useState([]);

  // Mini drawing canvas for "try the recognizer" demo
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d1a14';
    ctx.lineWidth = 3;
  }, []);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const startDraw = (e) => {
    drawingRef.current = true;
    lastRef.current = pos(e);
  };
  const draw = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  };
  const endDraw = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      setRecogStrokes(s => s + 1);
      // fake "guesses" stream
      const samples = [
        ['squiggle', 'wave', 'snake', 'cloud'],
        ['mountain', 'tooth', 'roof', 'tent'],
        ['cat', 'duck', 'bird', 'rabbit'],
        ['house', 'box', 'envelope', 'window'],
        ['flower', 'sun', 'star', 'wheel'],
      ];
      const s = samples[Math.floor(Math.random() * samples.length)];
      setGuesses(s);
    }
  };
  const clear = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setGuesses([]);
    setRecogStrokes(0);
  };

  return (
    <div className="page" style={{ position: 'relative' }}>
      {/* HERO */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 60, alignItems: 'start', marginTop: 24 }}>
        <div style={{ position: 'relative' }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M3 18 L 14 7 L 18 11 L 7 22" stroke="#d94a4a" strokeWidth="2" fill="#ffd84d"/>
              <path d="M14 7 L 17 4 L 21 8 L 18 11" stroke="#d94a4a" strokeWidth="2" fill="#ffc5d8"/>
            </svg>
            <span className="wavy">Quick Draw Multiplayer</span>
          </div>

          <h1 className="display-xl" style={{ position: 'relative', display: 'inline-block' }}>
            Draw
            <br />
            <span style={{ position: 'relative' }}>
              Battle
              <span style={{ color: 'var(--accent-red)' }}>!</span>
              <StarBurst size={56} color="var(--accent-red)" style={{ position: 'absolute', right: -64, top: -8 }} />
            </span>
          </h1>

          <p className="body" style={{ maxWidth: 480, marginTop: 20, fontSize: 22 }}>
            Real‑time multiplayer drawing rooms. Set the timer, pick how many people can join, share the link, and race through <span className="highlight">Quick Draw prompts</span> while a model tries to guess what you're scribbling.
          </p>

          {/* feature checklist */}
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 28, display: 'grid', gap: 10, fontFamily: "'Patrick Hand', cursive", fontSize: 20 }}>
            {[
              ['Up to 8 players per room', '#ffd84d'],
              ['Share an invite link in 1 click', '#7fb8e6'],
              ['AI guesses your sketch in real time', '#f17fa3'],
              ['No sign‑up. No download.', '#95cf91'],
            ].map(([t, c], i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="9" fill={c} stroke="#1d1a14" strokeWidth="2"/>
                  <path d="M6 11 L 10 15 L 16 7" stroke="#1d1a14" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA card / sticky */}
        <div style={{ position: 'relative', paddingTop: 24 }}>
          <div className="sticky tilt-r" style={{ position: 'relative' }}>
            <Tape pos="tc" color="pink" />
            <div style={{ fontFamily: "'Caveat', cursive", fontSize: 36, fontWeight: 700, lineHeight: 1, marginBottom: 10 }}>
              Start a room
            </div>
            <div style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 18, color: 'var(--ink-soft)', marginBottom: 18 }}>
              Takes about 4 seconds.
            </div>

            <label style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowDoodle width={26} height={14} />
              Your name
            </label>
            <input
              className="input"
              placeholder="e.g. Mira"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ background: 'transparent', borderColor: '#1d1a14', marginBottom: 18 }}
            />

            <button className="btn lg primary wiggle" onClick={() => onCreateRoom(name || 'Player')} style={{ width: '100%' }}>
              <SmallStar size={18} /> Create room
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Patrick Hand', cursive", fontSize: 16, marginTop: 14, color: 'var(--ink-soft)' }}>
              <span>or</span>
              <a href="#" onClick={(e) => { e.preventDefault(); onCreateRoom(name || 'Player', true); }} style={{ color: 'var(--accent-red)', textDecoration: 'underline wavy' }}>
                join with a code
              </a>
            </div>
          </div>

          {/* tiny scribbled note below the sticky */}
          <div style={{ marginTop: 22, fontFamily: "'Caveat', cursive", fontSize: 22, color: 'var(--ink-soft)', textAlign: 'center', position: 'relative' }}>
            <Squiggle width={120} height={8} color="var(--accent-pink)" />
            <div style={{ marginTop: 4 }}>over <span className="highlight pink">12,400</span> rooms played this week</div>
          </div>
        </div>
      </div>

      {/* divider with scribble */}
      <div style={{ margin: '60px 0 36px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Squiggle width={400} height={10} color="#c8c0a0" />
        <span className="mono" style={{ fontSize: 13, color: 'var(--ink-faint)', letterSpacing: 2 }}>BEFORE YOU START —</span>
        <div style={{ flex: 1, borderTop: '2px dashed var(--ink-faint)', height: 1 }}></div>
      </div>

      {/* Try the recognizer */}
      <div className="card tilt-l" style={{ position: 'relative', maxWidth: 1100 }}>
        <Tape pos="tl" />
        <Tape pos="tr" color="blue" dotted />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 28, alignItems: 'start' }}>
          <div>
            <div className="eyebrow" style={{ color: 'var(--accent-pink)', marginBottom: 6 }}>
              <span className="wavy" style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 8'><path d='M0 4 Q 10 0 20 4 T 40 4 T 60 4 T 80 4' stroke='%23f17fa3' stroke-width='1.8' fill='none'/></svg>\")" }}>Warm‑up</span>
            </div>
            <h2 className="display-lg">Try the recognizer.</h2>
            <p className="body" style={{ marginTop: 6, fontSize: 20 }}>
              Doodle anything in the box. The model reads your strokes and shouts out guesses.
            </p>

            <div style={{ position: 'relative', marginTop: 18 }}>
              <canvas
                ref={canvasRef}
                className="canvas-area"
                width={680}
                height={320}
                style={{
                  display: 'block', width: '100%', height: 320,
                  background: '#fff',
                  border: '2.5px solid var(--ink)',
                  borderRadius: '12px 16px 10px 14px / 12px 10px 16px 12px',
                  boxShadow: '3px 3px 0 var(--ink)',
                  touchAction: 'none',
                }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
              />
              {recogStrokes === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', flexDirection: 'column', gap: 8 }}>
                  <PencilDoodle width={180} height={28} />
                  <div style={{ fontFamily: "'Caveat', cursive", fontSize: 28, color: 'var(--ink-faint)' }}>draw something here →</div>
                </div>
              )}
              <button onClick={clear} className="btn sm ghost" style={{ position: 'absolute', top: 10, right: 10 }}>
                Clear
              </button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 13, color: 'var(--ink-faint)', letterSpacing: 1 }}>GUESSES →</span>
              {guesses.length === 0 ? (
                <span className="body" style={{ fontStyle: 'italic', fontSize: 18 }}>...thinking</span>
              ) : (
                guesses.map((g, i) => (
                  <span key={i} className={i === 0 ? 'highlight' : ''} style={{
                    fontFamily: "'Caveat', cursive", fontSize: 26, fontWeight: 700,
                    color: i === 0 ? 'var(--ink)' : 'var(--ink-soft)',
                    transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (i + 1) * 0.6}deg)`,
                    display: 'inline-block',
                  }}>
                    {g}{i < guesses.length - 1 ? ',' : ''}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Side: how to play */}
          <div style={{ paddingTop: 8 }}>
            <div className="dashed-box" style={{ background: 'rgba(255,255,255,0.6)' }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 1.2, marginBottom: 6 }}>HOW A ROUND GOES</div>
              <ol style={{ paddingLeft: 18, margin: 0, fontFamily: "'Patrick Hand', cursive", fontSize: 18, lineHeight: 1.6 }}>
                <li>Get a secret prompt</li>
                <li>Sketch it before time runs out</li>
                <li>AI guesses → points for you</li>
                <li>Highest score wins the match</li>
              </ol>
            </div>

            <div style={{ marginTop: 18, position: 'relative' }}>
              <SpeechBubble width={240} height={88}>
                <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 22 }}>"Is that... a pelican on a skateboard?"</div>
                <div style={{ fontSize: 14, color: 'var(--ink-faint)', marginTop: 4 }}>— the recognizer, probably</div>
              </SpeechBubble>
            </div>
          </div>
        </div>
      </div>

      {/* footer scribble */}
      <div style={{ marginTop: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: "'Patrick Hand', cursive", fontSize: 16, color: 'var(--ink-faint)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Heart size={16} /> made with pencils
        </div>
        <div className="mono" style={{ fontSize: 12 }}>v0.4.2 — last edited just now</div>
      </div>
    </div>
  );
};

window.Landing = Landing;
