/* Active Game Page */

const GamePage = ({ tweaks, roomCode, playerName, onExit }) => {
  const [timeLeft, setTimeLeft] = React.useState(75);
  const [round, setRound] = React.useState(2);
  const totalRounds = 5;
  const prompt = "pelican on a skateboard";
  const [tool, setTool] = React.useState('pencil');
  const [color, setColor] = React.useState('#1d1a14');
  const [size, setSize] = React.useState(3);
  const [strokes, setStrokes] = React.useState([]);
  const [redoStack, setRedoStack] = React.useState([]);
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);
  const currentStrokeRef = React.useRef(null);

  const [guesses, setGuesses] = React.useState([
    { who: 'AI', txt: 'a bird?', t: 12 },
    { who: 'Mira', txt: 'duck on a plank lol', t: 18 },
    { who: 'AI', txt: 'penguin?', t: 22 },
    { who: 'Jules', txt: 'I see... a flamingo??', t: 30 },
    { who: 'AI', txt: 'pelican!', correct: true, t: 38 },
  ]);

  const [scores] = React.useState([
    { name: playerName || 'You', color: 'yellow', initials: (playerName || 'YO').slice(0,2).toUpperCase(), score: 240, you: true, drawing: true },
    { name: 'Mira', color: 'pink', initials: 'MI', score: 180 },
    { name: 'Jules', color: 'blue', initials: 'JU', score: 150 },
    { name: 'Aki', color: 'green', initials: 'AK', score: 80 },
  ]);

  // Timer
  React.useEffect(() => {
    const t = setInterval(() => {
      setTimeLeft(s => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Setup canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      redrawAll();
    };
    resize();
  }, []);

  const redrawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach(s => drawStroke(ctx, s));
  };

  const drawStroke = (ctx, s) => {
    if (s.points.length < 2) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  React.useEffect(() => { redrawAll(); }, [strokes]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const start = (e) => {
    drawingRef.current = true;
    const p = pos(e);
    const sw = tool === 'eraser' ? size * 4 : (tool === 'marker' ? size * 2.5 : size);
    currentStrokeRef.current = { tool, color: tool === 'eraser' ? '#000' : color, size: sw, points: [p] };
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    currentStrokeRef.current.points.push(p);
    const ctx = canvasRef.current.getContext('2d');
    drawStroke(ctx, currentStrokeRef.current);
  };
  const end = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
        setStrokes(s => [...s, currentStrokeRef.current]);
      }
      currentStrokeRef.current = null;
      setRedoStack([]);
    }
  };

  const undo = () => {
    if (strokes.length === 0) return;
    setRedoStack(r => [strokes[strokes.length - 1], ...r]);
    setStrokes(s => s.slice(0, -1));
  };
  const redo = () => {
    if (redoStack.length === 0) return;
    setStrokes(s => [...s, redoStack[0]]);
    setRedoStack(r => r.slice(1));
  };
  const clear = () => {
    setRedoStack([]);
    setStrokes([]);
  };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const timerColor = timeLeft <= 15 ? 'var(--accent-red)' : timeLeft <= 30 ? 'var(--accent-orange)' : 'var(--ink)';
  const progressPct = (timeLeft / 90) * 100;

  return (
    <div className="page" style={{ position: 'relative' }}>
      {/* Top HUD */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 18, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={onExit} className="btn sm ghost">← leave room</button>

        {/* Round + prompt center */}
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 1.6 }}>
            ROUND {round} OF {totalRounds} · YOU'RE DRAWING
          </div>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: 4 }}>
            <span style={{ fontFamily: "'Caveat', cursive", fontSize: 44, fontWeight: 700, lineHeight: 1 }}>
              <span style={{ color: 'var(--ink-faint)' }}>"</span>
              <span className="highlight">{prompt}</span>
              <span style={{ color: 'var(--ink-faint)' }}>"</span>
            </span>
            <ArrowCurly width={70} height={50} style={{ position: 'absolute', right: -76, top: -12 }} color="var(--accent-pink)" />
          </div>
        </div>

        {/* Room badge */}
        <div className="card tilt-r" style={{ padding: '8px 14px', position: 'relative' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>ROOM</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 600 }}>{roomCode}</div>
        </div>
      </div>

      {/* Timer strip */}
      <div style={{ position: 'relative', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className={timeLeft <= 15 ? 'timer-tick' : ''} style={{
          fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 56, lineHeight: 1, color: timerColor, minWidth: 110,
        }}>
          {fmt(timeLeft)}
        </div>
        <div style={{ flex: 1, position: 'relative', height: 22, border: '2.5px solid var(--ink)', borderRadius: 14, background: 'var(--paper)', boxShadow: '2px 2px 0 var(--ink)', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: `${progressPct}%`,
            background: timeLeft <= 15 ? 'var(--accent-red)' : timeLeft <= 30 ? 'var(--accent-orange)' : 'var(--accent-yellow)',
            transition: 'width 0.5s linear, background 0.3s',
            backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 6px, transparent 6px 12px)',
          }} />
        </div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--ink-faint)', letterSpacing: 1 }}>
          {timeLeft <= 15 ? 'HURRY!' : timeLeft <= 30 ? 'KEEP GOING' : 'PLENTY OF TIME'}
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 280px', gap: 24, alignItems: 'start' }}>
        {/* Tool palette */}
        <div className="card tilt-l" style={{ position: 'relative', padding: 18 }}>
          <Tape pos="tc" color="kraft" />
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: 1.4, marginBottom: 10 }}>TOOLS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <ToolButton active={tool === 'pencil'} onClick={() => setTool('pencil')} label="Pencil" icon="✎" />
            <ToolButton active={tool === 'marker'} onClick={() => setTool('marker')} label="Marker" icon="✦" />
            <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} label="Eraser" icon="◊" />
            <ToolButton active={tool === 'fill'} onClick={() => setTool('fill')} label="Fill" icon="●" />
          </div>

          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: 1.4, marginBottom: 8 }}>COLOR</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 14 }}>
            {['#1d1a14','#d94a4a','#ff9a55','#ffd84d','#95cf91','#7fb8e6','#b48edb','#f17fa3','#8b5a3c','#fbf6e6'].map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width: 28, height: 28, borderRadius: '50%',
                background: c, border: color === c ? '3px solid var(--ink)' : '2px solid var(--ink)',
                boxShadow: color === c ? '2px 2px 0 var(--ink)' : '1px 1px 0 var(--ink)',
                cursor: 'pointer',
                transform: color === c ? 'scale(1.1)' : 'scale(1)',
                transition: 'transform 0.1s',
              }} />
            ))}
          </div>

          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: 1.4, marginBottom: 8 }}>SIZE</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
            {[2, 4, 7, 12].map(s => (
              <button key={s} onClick={() => setSize(s)} style={{
                width: 32, height: 32, border: size === s ? '2.5px solid var(--ink)' : '2px solid var(--ink-faint)',
                background: 'var(--paper)',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: size === s ? '2px 2px 0 var(--ink)' : 'none',
              }}>
                <div style={{ width: s * 1.5, height: s * 1.5, borderRadius: '50%', background: 'var(--ink)' }} />
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={undo} className="btn sm" style={{ flex: 1, fontSize: 16 }}>↶ undo</button>
            <button onClick={redo} className="btn sm" style={{ flex: 1, fontSize: 16 }}>↷ redo</button>
          </div>
          <button onClick={clear} className="btn sm danger" style={{ width: '100%', fontSize: 16 }}>clear</button>

          <div style={{ borderTop: '1px dashed var(--ink-faint)', marginTop: 14, paddingTop: 12, display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" style={{ flex: 1, fontSize: 14 }}>skip word</button>
            <button className="btn sm ghost" style={{ flex: 1, fontSize: 14 }}>hint</button>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ position: 'relative' }}>
          <div className="card" style={{ padding: 0, overflow: 'visible', position: 'relative' }}>
            <Tape pos="tl" />
            <Tape pos="tr" color="pink" />
            <canvas
              ref={canvasRef}
              className="canvas-area"
              width={700}
              height={520}
              style={{
                display: 'block', width: '100%', height: 520, background: '#fff',
                borderRadius: '12px 16px 10px 14px / 12px 10px 16px 12px',
                touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair',
              }}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            />
          </div>

          {/* Floating reactions */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14 }}>
            {['😂', '🔥', '👀', '🎨', '💀'].map((e, i) => (
              <button key={i} className="btn sm" style={{ fontSize: 22, padding: '4px 10px' }}>
                {e}
              </button>
            ))}
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', alignSelf: 'center', letterSpacing: 1, marginLeft: 8 }}>
              REACT TO YOURSELF
            </span>
          </div>
        </div>

        {/* Right: scoreboard + chat */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Scoreboard */}
          <div className="card tilt-r" style={{ position: 'relative' }}>
            <Tape pos="tl" color="green" />
            <div className="eyebrow" style={{ color: 'var(--accent-green)', marginBottom: 8 }}>
              <span className="wavy" style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 8'><path d='M0 4 Q 10 0 20 4 T 40 4 T 60 4 T 80 4' stroke='%2395cf91' stroke-width='1.8' fill='none'/></svg>\")" }}>Scoreboard</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scores.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: s.you ? 'rgba(255, 216, 77, 0.25)' : 'transparent',
                  border: s.you ? '2px solid var(--ink)' : '2px dashed transparent',
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 22, width: 22, color: i === 0 ? 'var(--accent-red)' : 'var(--ink-faint)' }}>
                      {i + 1}
                    </div>
                    <div className={`avatar ${s.color}`} style={{ width: 32, height: 32, fontSize: 16 }}>
                      {s.initials}
                    </div>
                    <div>
                      <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 18, lineHeight: 1 }}>
                        {s.name}
                        {s.drawing && <span className="mono" style={{ fontSize: 9, color: 'var(--accent-red)', letterSpacing: 1.2, marginLeft: 6 }}>DRAWING</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 24, color: 'var(--ink)' }}>
                    {s.score}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guess feed */}
          <div className="sticky orange tilt-l-soft" style={{ position: 'relative' }}>
            <Tape pos="tr" color="kraft" />
            <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
              Guess feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {guesses.map((g, i) => (
                <div key={i} style={{
                  fontFamily: "'Patrick Hand', cursive",
                  fontSize: 16,
                  padding: '6px 10px',
                  background: g.correct ? 'rgba(149, 207, 145, 0.6)' : 'rgba(255,255,255,0.5)',
                  border: g.correct ? '2px solid #4d8b48' : '1px dashed var(--ink-faint)',
                  borderRadius: 6,
                  transform: `rotate(${(i % 2 ? 1 : -1) * 0.5}deg)`,
                }}>
                  <span style={{ fontWeight: 700, color: g.who === 'AI' ? 'var(--accent-red)' : 'var(--ink)' }}>
                    {g.who}:
                  </span>{' '}
                  {g.txt}
                  {g.correct && <span className="mono" style={{ fontSize: 10, marginLeft: 6, color: '#4d8b48', letterSpacing: 1 }}>+100 ✓</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* bottom prompt strip */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: "'Patrick Hand', cursive", fontSize: 16, color: 'var(--ink-faint)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={20} />
          <span>tip: shapes first, details after — recognizer rewards big silhouettes</span>
        </div>
        <div className="mono" style={{ fontSize: 12, letterSpacing: 1 }}>
          {strokes.length} strokes · {scores.length} watching
        </div>
      </div>
    </div>
  );
};

const ToolButton = ({ active, onClick, label, icon }) => (
  <button onClick={onClick} style={{
    fontFamily: "'Caveat', cursive", fontSize: 18, fontWeight: 700,
    padding: '8px 6px',
    background: active ? 'var(--accent-yellow)' : 'var(--paper)',
    border: '2px solid var(--ink)',
    borderRadius: '8px 10px 8px 10px / 8px 8px 10px 10px',
    cursor: 'pointer',
    boxShadow: active ? 'inset 0 -2px 0 var(--ink)' : '2px 2px 0 var(--ink)',
    transform: active ? 'translate(1px, 1px)' : 'translate(0,0)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }}>
    <span style={{ fontSize: 16 }}>{icon}</span> {label}
  </button>
);

window.GamePage = GamePage;
