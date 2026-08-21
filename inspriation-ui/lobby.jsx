/* Lobby / Room setup page */

const Lobby = ({ tweaks, roomCode, playerName, onStart, onBack }) => {
  const [roundTime, setRoundTime] = React.useState(90);
  const [maxPlayers, setMaxPlayers] = React.useState(4);
  const [rounds, setRounds] = React.useState(5);
  const [difficulty, setDifficulty] = React.useState('mixed');
  const [ready, setReady] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [chat, setChat] = React.useState([
    { who: 'Mira', txt: 'hii ready when y\'all are', tilt: -2 },
    { who: 'Jules', txt: 'one sec, getting tea', tilt: 1 },
  ]);
  const [chatInput, setChatInput] = React.useState('');

  // Fake players in the room
  const players = [
    { name: playerName || 'You', color: 'yellow', ready: ready, you: true, initials: (playerName || 'YO').slice(0,2).toUpperCase() },
    { name: 'Mira', color: 'pink', ready: true, initials: 'MI' },
    { name: 'Jules', color: 'blue', ready: false, initials: 'JU' },
  ].slice(0, maxPlayers);

  const seats = Array(maxPlayers).fill(null).map((_, i) => players[i] || null);

  const copyLink = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChat(c => [...c, { who: playerName || 'You', txt: chatInput, tilt: (Math.random() * 4 - 2) }]);
    setChatInput('');
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="page" style={{ position: 'relative' }}>
      {/* Top status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={onBack} className="btn sm ghost" style={{ marginBottom: 12 }}>
            ← back
          </button>
          <div className="eyebrow">
            <span className="bullet"></span>
            <span className="wavy">Room {roomCode}</span>
          </div>
          <h1 className="display-lg" style={{ marginTop: 4 }}>
            Set up the room.
          </h1>
          <div className="body" style={{ fontSize: 20, marginTop: 6, maxWidth: 540 }}>
            Tweak the rules, share the link, then everyone hits ready. We start when the room agrees.
          </div>
        </div>

        {/* Player tag pinned top right */}
        <div className="card tilt-r" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <Tape pos="tc" color="kraft" />
          <div className={`avatar ${players[0].color}`}>{players[0].initials}</div>
          <div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: 1, color: 'var(--ink-faint)' }}>YOU ARE</div>
            <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 24, lineHeight: 1 }}>
              {playerName || 'Player'}
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32, alignItems: 'start' }}>
        {/* Left: settings */}
        <div className="card tilt-l" style={{ position: 'relative', padding: '32px 36px' }}>
          <Tape pos="tl" />
          <div className="eyebrow" style={{ marginBottom: 18 }}>
            <ArrowDoodle width={28} height={14} color="var(--accent-red)" />
            <span className="wavy">Match Settings</span>
          </div>

          {/* Round time */}
          <SettingRow
            label="Round time"
            hint="how long each player has to draw"
          >
            <Segmented
              options={[
                { v: 45, l: '0:45' },
                { v: 60, l: '1:00' },
                { v: 90, l: '1:30' },
                { v: 120, l: '2:00' },
              ]}
              value={roundTime}
              onChange={setRoundTime}
            />
          </SettingRow>

          {/* Players */}
          <SettingRow label="Max players" hint="seats in the room">
            <Segmented
              options={[
                { v: 2, l: '2' },
                { v: 4, l: '4' },
                { v: 6, l: '6' },
                { v: 8, l: '8' },
              ]}
              value={maxPlayers}
              onChange={setMaxPlayers}
            />
          </SettingRow>

          {/* Rounds */}
          <SettingRow label="Rounds" hint="best of...">
            <Segmented
              options={[
                { v: 3, l: '3' },
                { v: 5, l: '5' },
                { v: 7, l: '7' },
                { v: 10, l: '10' },
              ]}
              value={rounds}
              onChange={setRounds}
            />
          </SettingRow>

          {/* Difficulty */}
          <SettingRow label="Difficulty" hint="prompt deck">
            <Segmented
              options={[
                { v: 'easy', l: 'easy' },
                { v: 'mixed', l: 'mixed' },
                { v: 'hard', l: 'hard' },
                { v: 'chaos', l: 'chaos' },
              ]}
              value={difficulty}
              onChange={setDifficulty}
            />
          </SettingRow>

          {/* Toggles */}
          <div style={{ borderTop: '2px dashed var(--ink-faint)', marginTop: 18, paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 1.2 }}>EXTRAS</div>
            <HandCheckbox checked label="AI judges your sketch (recommended)" onClick={() => {}} />
            <HandCheckbox checked label="Friends can spectate after room is full" onClick={() => {}} />
            <HandCheckbox checked={false} label="Allow word swap once per match" onClick={() => {}} />
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, gap: 18, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 1.2 }}>STATUS</div>
              <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 26 }}>
                {seats.filter(s => s && s.ready).length} / {maxPlayers} ready
              </div>
              <Squiggle width={140} height={6} color="var(--accent-pink)" />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn ghost" onClick={onBack}>Back</button>
              <button
                className={`btn ${ready ? 'success' : 'primary'} wiggle`}
                onClick={() => setReady(r => !r)}
              >
                {ready ? '✓ I\'m ready' : 'Mark me ready'}
              </button>
              <button
                className="btn danger lg"
                disabled={seats.filter(s => s && s.ready).length < 2}
                onClick={onStart}
                style={{
                  opacity: seats.filter(s => s && s.ready).length < 2 ? 0.5 : 1,
                  cursor: seats.filter(s => s && s.ready).length < 2 ? 'not-allowed' : 'pointer',
                }}
              >
                <SmallStar size={16} color="#fff" /> Start match
              </button>
            </div>
          </div>
        </div>

        {/* Right: lobby + invite + chat */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Players list */}
          <div className="card tilt-r" style={{ position: 'relative' }}>
            <Tape pos="tl" color="green" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div className="eyebrow" style={{ color: 'var(--accent-blue)' }}>
                  <span className="wavy blue">Lobby</span>
                </div>
                <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 32, lineHeight: 1 }}>
                  {seats.filter(Boolean).length} of {maxPlayers}
                </div>
              </div>
              <span className="stamp green">Live</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {seats.map((s, i) => (
                <PlayerRow key={i} seat={s} index={i} />
              ))}
            </div>
          </div>

          {/* Invite */}
          <div className="sticky pink tilt-l-soft" style={{ position: 'relative' }}>
            <Tape pos="tr" color="pink" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 28 }}>
              <Squiggle width={28} height={8} color="var(--accent-red)" />
              Invite friends
            </div>
            <div style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 18, color: 'var(--ink)', marginTop: 6 }}>
              Send this link. Extra people can spectate once the room is full.
            </div>
            <div style={{
              marginTop: 14,
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.65)',
              border: '2px dashed var(--ink)',
              borderRadius: 8,
              padding: '8px 12px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              gap: 8,
              justifyContent: 'space-between',
            }}>
              <span>drawbattle.fun/{roomCode.toLowerCase()}</span>
              <button className="btn sm" onClick={copyLink} style={{ padding: '4px 12px', fontSize: 16, boxShadow: '2px 2px 0 #1d1a14' }}>
                {copied ? '✓ copied' : 'copy'}
              </button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm ghost">Twitter</button>
              <button className="btn sm ghost">Discord</button>
              <button className="btn sm ghost">QR</button>
            </div>
          </div>

          {/* Chat */}
          <div className="card tilt-l-2" style={{ position: 'relative', padding: 18 }}>
            <Tape pos="tr" dotted />
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 1.2, marginBottom: 8 }}>ROOM CHAT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 140, overflowY: 'auto', marginBottom: 10 }}>
              {chat.map((m, i) => (
                <div key={i} style={{
                  fontFamily: "'Patrick Hand', cursive", fontSize: 17,
                  transform: `rotate(${m.tilt}deg)`,
                  transformOrigin: 'left',
                }}>
                  <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{m.who}:</span> {m.txt}
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="say something..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn sm primary">send</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingRow = ({ label, hint, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, alignItems: 'center', padding: '14px 0', borderBottom: '1px dashed rgba(0,0,0,0.12)' }}>
    <div>
      <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 15, color: 'var(--ink-faint)' }}>{hint}</div>
    </div>
    <div>{children}</div>
  </div>
);

const Segmented = ({ options, value, onChange }) => (
  <div style={{
    display: 'inline-flex',
    border: '2.5px solid var(--ink)',
    borderRadius: '10px 14px 8px 12px / 10px 8px 14px 10px',
    padding: 3,
    background: 'var(--paper)',
    boxShadow: '2px 2px 0 var(--ink)',
    gap: 2,
  }}>
    {options.map(opt => (
      <button
        key={opt.v}
        onClick={() => onChange(opt.v)}
        style={{
          fontFamily: "'Caveat', cursive",
          fontWeight: 700,
          fontSize: 22,
          padding: '6px 16px',
          border: 'none',
          background: value === opt.v ? 'var(--accent-yellow)' : 'transparent',
          borderRadius: 8,
          cursor: 'pointer',
          boxShadow: value === opt.v ? 'inset 0 -2px 0 var(--ink)' : 'none',
          color: value === opt.v ? 'var(--ink)' : 'var(--ink-soft)',
        }}
      >
        {opt.l}
      </button>
    ))}
  </div>
);

const PlayerRow = ({ seat, index }) => {
  if (!seat) {
    return (
      <div className="dashed-box" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="avatar empty">?</div>
          <div style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 18, color: 'var(--ink-faint)' }}>
            Open seat {index + 1}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: 1.5 }}>WAITING…</span>
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: 'rgba(255,255,255,0.55)',
      border: '2px solid var(--ink)',
      borderRadius: 10,
      boxShadow: '2px 2px 0 var(--ink)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className={`avatar ${seat.color}`}>{seat.initials}</div>
        <div>
          <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 22, lineHeight: 1 }}>
            {seat.name}{seat.you && <span style={{ color: 'var(--accent-red)', fontSize: 16, marginLeft: 6 }}>(you)</span>}
          </div>
          <div style={{ fontFamily: "'Patrick Hand', cursive", fontSize: 14, color: 'var(--ink-faint)' }}>
            seat {index + 1}
          </div>
        </div>
      </div>
      {seat.ready ? (
        <span className="stamp green">Ready</span>
      ) : (
        <span className="stamp">Not ready</span>
      )}
    </div>
  );
};

window.Lobby = Lobby;
