import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

const c = {
  desktop: "#080B11",
  chrome: "#151B26",
  chrome2: "#1B2331",
  terminal: "#0B1018",
  line: "#2B374B",
  text: "#EDF2FA",
  muted: "#91A0B7",
  violet: "#8C7CFF",
  cyan: "#4BD7E9",
  green: "#53E39B",
  amber: "#FFCA62",
  red: "#FF7180",
};

const ui: CSSProperties = {
  fontFamily: "Inter, SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif",
  color: c.text,
};

const mono: CSSProperties = {
  fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  color: c.text,
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const fade = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, start + 12, end - 12, end], [0, 1, 1, 0], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const TerminalWindow = ({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      background: c.terminal,
      border: `1px solid ${c.line}`,
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 28px 90px #00000080",
      ...style,
    }}
  >
    <div
      style={{
        ...ui,
        height: 48,
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        padding: "0 18px",
        background: c.chrome2,
        borderBottom: `1px solid ${c.line}`,
        color: c.muted,
        fontSize: 17,
        fontWeight: 750,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {[c.red, c.amber, c.green].map((color) => (
          <div key={color} style={{ width: 12, height: 12, borderRadius: 99, background: color }} />
        ))}
      </div>
      <div>{title}</div>
      <div />
    </div>
    {children}
  </div>
);

const Key = ({ children }: { children: ReactNode }) => (
  <span
    style={{
      ...mono,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 30,
      height: 28,
      padding: "0 7px",
      borderRadius: 6,
      background: c.chrome2,
      border: `1px solid ${c.line}`,
      fontSize: 16,
      fontWeight: 800,
    }}
  >
    {children}
  </span>
);

type Row = {
  state: string;
  id: string;
  trigger: string;
  next: string;
  last: string;
};

const Board = ({
  selected = 0,
  rows,
  paused = false,
  message = "",
}: {
  selected?: number;
  rows: Row[];
  paused?: boolean;
  message?: string;
}) => (
  <div style={{ ...mono, padding: "24px 30px 22px", fontSize: 19, lineHeight: 1.45 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 7,
      }}
    >
      <div>
        <span style={{ color: c.cyan, fontWeight: 900 }}>Herdr Automations</span>
        <span style={{ color: c.muted }}> worker=20610 </span>
        <span style={{ color: paused ? c.amber : c.green, fontWeight: 850 }}>
          {paused ? "PAUSED" : "RUNNING"}
        </span>
      </div>
      <span style={{ color: c.muted, fontSize: 15 }}>
        config: ~/.config/herdr/.../automations.yaml
      </span>
    </div>
    <div style={{ height: 1, background: c.line, margin: "12px 0 15px" }} />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "34px 125px 210px 300px 220px 1fr",
        color: c.muted,
        fontWeight: 800,
        fontSize: 16,
        marginBottom: 8,
      }}
    >
      <div />
      <div>STATUS</div>
      <div>ID</div>
      <div>TRIGGER</div>
      <div>NEXT</div>
      <div>LAST</div>
    </div>
    {rows.map((row, index) => (
      <div
        key={row.id}
        style={{
          display: "grid",
          gridTemplateColumns: "34px 125px 210px 300px 220px 1fr",
          alignItems: "center",
          minHeight: 44,
          padding: "3px 0",
          borderRadius: 7,
          background: index === selected ? "#24324A" : "transparent",
        }}
      >
        <div style={{ color: c.cyan, fontWeight: 900, paddingLeft: 8 }}>
          {index === selected ? ">" : ""}
        </div>
        <div
          style={{
            color: row.state === "running" ? c.green : row.state === "disabled" ? c.muted : c.text,
          }}
        >
          {row.state}
        </div>
        <div style={{ fontWeight: 800 }}>{row.id}</div>
        <div style={{ color: c.muted }}>{row.trigger}</div>
        <div>{row.next}</div>
        <div style={{ color: row.last.startsWith("succeeded") ? c.green : c.muted }}>
          {row.last}
        </div>
      </div>
    ))}
    <div style={{ height: 1, background: c.line, margin: "15px 0 13px" }} />
    <div
      style={{
        display: "flex",
        gap: 17,
        alignItems: "center",
        color: c.muted,
        fontFamily: ui.fontFamily,
        fontSize: 16,
      }}
    >
      <span>
        <Key>?</Key> help
      </span>
      <span>
        <Key>r</Key> reload
      </span>
      <span>
        <Key>p</Key> pause
      </span>
      <span>
        <Key>e</Key> enable
      </span>
      <span>
        <Key>n</Key> run
      </span>
      <span>
        <Key>c</Key> cancel
      </span>
      <span>
        <Key>t</Key> retry
      </span>
      <span>
        <Key>h</Key> hist
      </span>
      <span>
        <Key>o</Key> config
      </span>
    </div>
    <div
      style={{
        height: 26,
        marginTop: 12,
        color: message.includes("queued") ? c.cyan : message.includes("paused") ? c.amber : c.green,
      }}
    >
      {message}
    </div>
  </div>
);

const YamlEditor = ({ frame }: { frame: number }) => {
  const allLines = [
    "version: 1",
    "defaults:",
    "  timezone: America/Argentina/Buenos_Aires",
    "  overlap: skip",
    "",
    "automations:",
    "  - id: inbox-summary",
    "    name: Inbox summary",
    "    enabled: true",
    "    cwd: /Users/ramiro/Desktop/projects/personales",
    "    trigger:",
    "      type: interval",
    "      every: 30m",
    "    action:",
    "      type: agent",
    "      kind: codex",
    "      name: inbox-summary",
    '      prompt: "Summarize new email and next actions."',
  ];
  const typed = Math.floor(
    interpolate(frame, [115, 205], [6, allLines.length], {
      ...clamp,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    }),
  );
  return (
    <div style={{ ...mono, padding: "22px 28px", fontSize: 19, lineHeight: 1.38, minHeight: 540 }}>
      {allLines.slice(0, typed).map((line, index) => {
        const parts = line.match(/^(\s*-?\s*)([^:]+:)(.*)$/);
        return (
          <div key={`${index}-${line}`} style={{ minHeight: 27, display: "flex" }}>
            <span style={{ width: 38, color: "#52627A", textAlign: "right", marginRight: 22 }}>
              {index + 1}
            </span>
            {parts ? (
              <>
                <span>{parts[1]}</span>
                <span style={{ color: c.cyan }}>{parts[2]}</span>
                <span style={{ color: parts[3].includes("true") ? c.green : c.text }}>
                  {parts[3]}
                </span>
              </>
            ) : (
              <span>{line}</span>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", marginLeft: 60 }}>
        <div
          style={{
            width: 11,
            height: 24,
            background: c.violet,
            opacity: Math.floor(frame / 8) % 2 ? 1 : 0.25,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 31,
          padding: "5px 18px",
          background: "#302A68",
          color: "white",
          fontSize: 15,
        }}
      >
        NORMAL automations.yaml {typed}/{allLines.length}
      </div>
    </div>
  );
};

const AgentPane = ({ frame }: { frame: number }) => {
  const lines = [
    ["›", "Summarize new email and next actions.", c.violet],
    ["•", "Using Gmail connector in read-only mode…", c.muted],
    ["•", "Found 3 new threads since the last run.", c.muted],
    ["•", "Prioritizing decisions and follow-ups…", c.muted],
    ["✓", "Summary complete. 2 actions need attention.", c.green],
  ] as const;
  const visible = Math.floor(interpolate(frame, [365, 465], [1, lines.length], clamp));
  return (
    <div style={{ ...mono, padding: "27px 31px", fontSize: 20, lineHeight: 1.6, minHeight: 475 }}>
      {lines.slice(0, visible).map(([mark, text, color], index) => (
        <div
          key={text}
          style={{
            opacity: interpolate(frame, [365 + index * 22, 375 + index * 22], [0, 1], clamp),
            color,
            marginBottom: 10,
          }}
        >
          <span style={{ display: "inline-block", width: 34, fontWeight: 900 }}>{mark}</span>
          {text}
        </div>
      ))}
      {frame >= 460 && (
        <div
          style={{
            ...ui,
            marginTop: 24,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: c.green,
            fontSize: 21,
            fontWeight: 850,
          }}
        >
          <div
            style={{
              width: 11,
              height: 11,
              borderRadius: 99,
              background: c.green,
              boxShadow: `0 0 20px ${c.green}`,
            }}
          />
          done
        </div>
      )}
    </div>
  );
};

const History = () => (
  <div style={{ ...mono, padding: "24px 30px", minHeight: 465, fontSize: 18, lineHeight: 1.75 }}>
    <div style={{ color: c.cyan, fontWeight: 900, marginBottom: 15 }}>History · inbox-summary</div>
    <div>
      <span style={{ color: c.muted }}>run_0042</span>{" "}
      <span style={{ color: c.green }}>succeeded</span> agent done · 16.2s
    </div>
    <div>
      <span style={{ color: c.muted }}>run_0041</span>{" "}
      <span style={{ color: c.green }}>succeeded</span> agent done · 14.8s
    </div>
    <div>
      <span style={{ color: c.muted }}>run_0040</span>{" "}
      <span style={{ color: c.amber }}>skipped_overlap</span> active run exists
    </div>
    <div style={{ marginTop: 28, color: c.muted }}>[q] back</div>
  </div>
);

const Toast = ({
  text,
  frame,
  start,
  end,
}: {
  text: string;
  frame: number;
  start: number;
  end: number;
}) => (
  <div
    style={{
      ...ui,
      position: "absolute",
      left: "50%",
      bottom: 48,
      translate: "-50% 0",
      opacity: fade(frame, start, end),
      padding: "12px 18px",
      borderRadius: 12,
      background: "#111827E8",
      border: `1px solid ${c.line}`,
      boxShadow: "0 16px 45px #00000070",
      fontSize: 18,
      fontWeight: 700,
    }}
  >
    {text}
  </div>
);

const Cursor = ({ frame }: { frame: number }) => {
  const keyframes = [
    [0, 1450, 650],
    [75, 1470, 765],
    [250, 620, 508],
    [320, 590, 487],
    [520, 590, 487],
    [610, 590, 487],
    [720, 590, 487],
    [899, 590, 487],
  ];
  let segment = 0;
  while (segment < keyframes.length - 2 && frame > keyframes[segment + 1][0]) segment += 1;
  const a = keyframes[segment];
  const b = keyframes[segment + 1];
  const x = interpolate(frame, [a[0], b[0]], [a[1], b[1]], clamp);
  const y = interpolate(frame, [a[0], b[0]], [a[2], b[2]], clamp);
  const click = [80, 260, 325, 525, 615, 725].some((at) => Math.abs(frame - at) < 5);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 28,
        height: 38,
        zIndex: 50,
        scale: click ? 0.82 : 1,
      }}
    >
      <svg viewBox="0 0 28 38" width="28" height="38">
        <path
          d="M2 2 L24 22 L14 24 L20 35 L15 37 L9 26 L2 32 Z"
          fill="white"
          stroke="#0A0D12"
          strokeWidth="2"
        />
      </svg>
      {click && (
        <div
          style={{
            position: "absolute",
            left: -13,
            top: -13,
            width: 45,
            height: 45,
            borderRadius: 99,
            border: `3px solid ${c.cyan}`,
            opacity: 0.8,
          }}
        />
      )}
    </div>
  );
};

const Desktop = ({ frame }: { frame: number }) => {
  const initialRows: Row[] = [
    {
      state: "enabled",
      id: "daily-research",
      trigger: "cron 0 9 * * 1-5",
      next: "tomorrow 09:00",
      last: "succeeded@09:00",
    },
    {
      state: "enabled",
      id: "blocked-alert",
      trigger: "event pane.agent_status",
      next: "-",
      last: "-",
    },
  ];
  const rows: Row[] = [
    {
      state: frame >= 335 && frame < 475 ? "running" : "enabled",
      id: "inbox-summary",
      trigger: "every 30m",
      next: frame >= 475 ? "in 29m" : "in 30m",
      last: frame >= 475 ? "succeeded@12:30" : "-",
    },
    ...initialRows,
  ];

  const editorOpen = frame >= 95 && frame < 230;
  const splitOpen = frame >= 345 && frame < 500;
  const historyOpen = frame >= 605 && frame < 690;
  const paused = frame >= 730;
  const boardMessage =
    frame >= 230 && frame < 285
      ? "opened config and reloaded"
      : frame >= 320 && frame < 365
        ? "queued inbox-summary"
        : frame >= 730
          ? "paused"
          : "";

  return (
    <AbsoluteFill style={{ ...ui, background: c.desktop }}>
      <div
        style={{
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          background: "#0D1119",
          borderBottom: `1px solid #202A3A`,
          fontSize: 14,
          color: c.muted,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ color: c.text, fontWeight: 850 }}>Herdr</span>
          <span>Workspace: personales</span>
        </div>
        <div>Thu Aug 13 · 12:30</div>
      </div>
      <div
        style={{
          height: 50,
          display: "flex",
          alignItems: "center",
          background: c.chrome,
          borderBottom: `1px solid ${c.line}`,
        }}
      >
        <div style={{ width: 245, paddingLeft: 24, fontWeight: 800 }}>personales</div>
        {["1  shell", "2  code", "3  auto:inbox-summary"].map((tab, i) => (
          <div
            key={tab}
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              padding: "0 25px",
              color: splitOpen && i === 2 ? c.text : c.muted,
              background: splitOpen && i === 2 ? c.chrome2 : "transparent",
              borderBottom:
                splitOpen && i === 2 ? `3px solid ${c.violet}` : "3px solid transparent",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            {tab}
          </div>
        ))}
      </div>
      <div
        style={{ height: "calc(100% - 88px)", display: "grid", gridTemplateColumns: "245px 1fr" }}
      >
        <div
          style={{
            background: "#0D121B",
            borderRight: `1px solid ${c.line}`,
            padding: "21px 15px",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 850,
              color: c.muted,
              letterSpacing: 1,
              padding: "0 10px 12px",
            }}
          >
            WORKSPACE
          </div>
          {["README.md", "automations.yaml", "src/", "tests/", "video/"].map((item, i) => (
            <div
              key={item}
              style={{
                height: 34,
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 10px",
                borderRadius: 7,
                color: i === 1 && editorOpen ? c.text : c.muted,
                background: i === 1 && editorOpen ? "#202B3E" : "transparent",
                fontSize: 15,
              }}
            >
              <span style={{ color: i < 2 ? c.cyan : c.violet }}>{i < 2 ? "◇" : "▸"}</span>
              {item}
            </div>
          ))}
          <div
            style={{
              marginTop: 30,
              fontSize: 13,
              fontWeight: 850,
              color: c.muted,
              letterSpacing: 1,
              padding: "0 10px 12px",
            }}
          >
            AGENTS
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 10px",
              fontSize: 15,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: splitOpen ? c.green : c.muted,
              }}
            />
            inbox-summary{" "}
            <span style={{ marginLeft: "auto", color: splitOpen ? c.green : c.muted }}>
              {splitOpen ? "working" : "done"}
            </span>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            background: "radial-gradient(circle at 85% 10%, #191541, transparent 32%), #090D14",
          }}
        >
          {!editorOpen && (
            <div style={{ position: "absolute", inset: "34px 42px" }}>
              <TerminalWindow
                title="Herdr Automations · popup"
                style={{ width: splitOpen ? "56%" : "88%", margin: "0 auto" }}
              >
                {historyOpen ? (
                  <History />
                ) : (
                  <Board selected={0} rows={rows} paused={paused} message={boardMessage} />
                )}
              </TerminalWindow>
              {splitOpen && (
                <TerminalWindow
                  title="auto:inbox-summary · Codex"
                  style={{ position: "absolute", top: 28, right: 0, width: "43%" }}
                >
                  <AgentPane frame={frame} />
                </TerminalWindow>
              )}
            </div>
          )}
          {editorOpen && (
            <div style={{ position: "absolute", inset: "24px 34px" }}>
              <TerminalWindow
                title="automations.yaml · $EDITOR"
                style={{ height: "100%", position: "relative" }}
              >
                <YamlEditor frame={frame} />
              </TerminalWindow>
            </div>
          )}
          <Toast text="Press o · edit automations.yaml" frame={frame} start={55} end={108} />
          <Toast
            text="Save & close · config reloads automatically"
            frame={frame}
            start={190}
            end={242}
          />
          <Toast text="Press n · run now" frame={frame} start={285} end={345} />
          <Toast
            text="The agent runs in a visible reusable pane"
            frame={frame}
            start={375}
            end={475}
          />
          <Toast text="Press h · inspect durable history" frame={frame} start={565} end={615} />
          <Toast
            text="Press p · pause all automatic triggers"
            frame={frame}
            start={695}
            end={745}
          />
        </div>
      </div>
      <Cursor frame={frame} />
    </AbsoluteFill>
  );
};

export const HerdrAutomationsFeatureVideo = () => {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 18], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const outro = interpolate(frame, [820, 855], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <AbsoluteFill style={{ background: "#05070B" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: intro,
          scale: interpolate(frame, [0, 25], [1.025, 1], clamp),
        }}
      >
        <Desktop frame={frame} />
      </div>
      <div
        style={{
          ...ui,
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 22,
          background: "#070A10F2",
          opacity: outro,
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 68, fontWeight: 900, letterSpacing: -3 }}>Herdr Automations</div>
        <div style={{ fontSize: 30, color: c.muted }}>
          Durable scheduling. Visible execution. Full control.
        </div>
        <div
          style={{
            ...mono,
            marginTop: 10,
            padding: "17px 24px",
            borderRadius: 14,
            background: c.terminal,
            border: `1px solid ${c.line}`,
            fontSize: 23,
          }}
        >
          <span style={{ color: c.muted }}>$ </span>
          <span style={{ color: c.cyan }}>herdr plugin install</span> ram4-dev/herdr-automations
        </div>
      </div>
    </AbsoluteFill>
  );
};
