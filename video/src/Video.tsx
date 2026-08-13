import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

const c = {
  bg: "#07090E",
  panel: "#111722",
  panel2: "#151D2A",
  line: "#283449",
  text: "#F7F9FD",
  muted: "#9DAAC0",
  violet: "#8A78FF",
  cyan: "#48D5E7",
  green: "#52E39A",
  amber: "#FFCA62",
  red: "#FF7180",
};

const base: CSSProperties = {
  fontFamily: "Inter, SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif",
  color: c.text,
};

const enter = (frame: number, delay = 0, distance = 34) => ({
  opacity: interpolate(frame, [delay, delay + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  }),
  translate: `${interpolate(frame, [delay, delay + 18], [-distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px 0`,
});

const Scene = ({ children, index }: { children: ReactNode; index: string }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        ...base,
        background:
          "radial-gradient(circle at 88% 8%, #292160 0%, transparent 34%), radial-gradient(circle at 2% 96%, #0B414A 0%, transparent 31%), #07090E",
        padding: "58px 92px 52px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            "linear-gradient(#FFFFFF0A 1px, transparent 1px), linear-gradient(90deg, #FFFFFF0A 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          translate: `${interpolate(frame, [0, 180], [0, -18])}px ${interpolate(frame, [0, 180], [0, -18])}px`,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 2,
          fontSize: 25,
          fontWeight: 800,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 99,
              background: c.violet,
              boxShadow: `0 0 28px ${c.violet}`,
            }}
          />
          Herdr Automations
        </div>
        <div style={{ color: c.muted }}>{index}</div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", zIndex: 1 }}>{children}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 24, zIndex: 2 }}>
        <div
          style={{ height: 4, flex: 1, background: c.line, borderRadius: 99, overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${interpolate(frame, [0, 180], [0, 100], { extrapolateRight: "clamp" })}%`,
              background: `linear-gradient(90deg, ${c.violet}, ${c.cyan})`,
            }}
          />
        </div>
        <div style={{ fontSize: 23, color: c.muted, fontWeight: 700 }}>
          github.com/ram4-dev/herdr-automations
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Badge = ({ children, color = c.cyan }: { children: ReactNode; color?: string }) => (
  <div
    style={{
      display: "inline-flex",
      alignSelf: "flex-start",
      padding: "10px 18px",
      borderRadius: 99,
      background: `${color}16`,
      border: `2px solid ${color}70`,
      color,
      fontSize: 23,
      fontWeight: 850,
      letterSpacing: 1,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Title = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 84, lineHeight: 0.98, fontWeight: 880, letterSpacing: -4 }}>
    {children}
  </div>
);

const Copy = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 34, lineHeight: 1.28, color: c.muted, fontWeight: 560 }}>{children}</div>
);

const Window = ({
  title,
  children,
  accent = c.violet,
}: {
  title: string;
  children: ReactNode;
  accent?: string;
}) => (
  <div
    style={{
      background: `${c.panel}F2`,
      border: `2px solid ${c.line}`,
      borderRadius: 28,
      overflow: "hidden",
      boxShadow: "0 34px 80px #00000070",
    }}
  >
    <div
      style={{
        height: 58,
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: c.panel2,
        borderBottom: `2px solid ${c.line}`,
        color: c.muted,
        fontSize: 22,
        fontWeight: 750,
      }}
    >
      <div style={{ display: "flex", gap: 9 }}>
        {[c.red, c.amber, c.green].map((color) => (
          <div key={color} style={{ width: 13, height: 13, borderRadius: 99, background: color }} />
        ))}
      </div>
      {title}
      <div style={{ width: 55, height: 5, borderRadius: 99, background: accent }} />
    </div>
    {children}
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const chips = ["cron", "intervalos", "eventos Herdr"];
  return (
    <Scene index="01 / 06">
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "0.95fr 1.05fr",
          gap: 90,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={enter(frame, 0)}>
            <Badge>Automatización observable</Badge>
          </div>
          <div style={enter(frame, 8)}>
            <Title>
              Tus agentes trabajan
              <br />
              <span style={{ color: c.cyan }}>aunque cierres el pane.</span>
            </Title>
          </div>
          <div style={enter(frame, 16)}>
            <Copy>Programá comandos y agentes con un worker durable dentro de Herdr.</Copy>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {chips.map((chip, i) => (
              <div
                key={chip}
                style={{
                  ...enter(frame, 24 + i * 6),
                  padding: "12px 18px",
                  borderRadius: 14,
                  background: c.panel,
                  border: `1px solid ${c.line}`,
                  fontSize: 24,
                  fontWeight: 750,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>
        <div style={enter(frame, 18)}>
          <Window title="Automations board">
            <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                ["Daily research", "cron 0 9 * * 1-5", "scheduled", c.cyan],
                ["Inbox summary", "every 30m", "running", c.green],
                ["Blocked agent alert", "pane.agent_status_changed", "watching", c.violet],
              ].map(([name, trigger, status, color]) => (
                <div
                  key={name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1.1fr 0.7fr",
                    alignItems: "center",
                    padding: "20px 22px",
                    borderRadius: 18,
                    background: c.panel2,
                    fontSize: 23,
                  }}
                >
                  <div style={{ fontWeight: 820 }}>{name}</div>
                  <div
                    style={{
                      color: c.muted,
                      fontFamily: "SFMono-Regular, monospace",
                      fontSize: 19,
                    }}
                  >
                    {trigger}
                  </div>
                  <div style={{ justifySelf: "end", color, fontWeight: 800 }}>{status}</div>
                </div>
              ))}
            </div>
          </Window>
        </div>
      </div>
    </Scene>
  );
};

const Configure = () => {
  const frame = useCurrentFrame();
  const lines = [
    ["id:", "daily-research"],
    ["enabled:", "true"],
    ["trigger:", "cron 0 9 * * 1-5"],
    ["action:", "agent · codex"],
    ["prompt:", "Summarize today’s signals"],
  ];
  return (
    <Scene index="02 / 06">
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "0.78fr 1.22fr",
          gap: 90,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={enter(frame, 0)}>
            <Badge color={c.violet}>1. Declarar</Badge>
          </div>
          <div style={enter(frame, 8)}>
            <Title>
              Una tarea.
              <br />
              <span style={{ color: c.violet }}>Un archivo YAML.</span>
            </Title>
          </div>
          <div style={enter(frame, 16)}>
            <Copy>Definí cuándo corre, dónde trabaja y qué agente o comando ejecuta.</Copy>
          </div>
        </div>
        <div style={enter(frame, 16)}>
          <Window title="automations.yaml" accent={c.violet}>
            <div
              style={{
                padding: "30px 36px",
                fontFamily: "SFMono-Regular, Menlo, monospace",
                fontSize: 26,
                lineHeight: 1.65,
              }}
            >
              <div style={{ color: c.muted }}>automations:</div>
              {lines.map(([key, value], i) => (
                <div
                  key={key}
                  style={{
                    ...enter(frame, 24 + i * 7, 20),
                    display: "grid",
                    gridTemplateColumns: "170px 1fr",
                    paddingLeft: 36,
                  }}
                >
                  <span style={{ color: c.cyan }}>
                    {i === 0 ? "- " : "  "}
                    {key}
                  </span>
                  <span style={{ color: i === 1 ? c.green : c.text }}>{value}</span>
                </div>
              ))}
            </div>
          </Window>
        </div>
      </div>
    </Scene>
  );
};

const Schedule = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [20, 145], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Scene index="03 / 06">
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "0.9fr 1.1fr",
          gap: 88,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={enter(frame, 0)}>
            <Badge color={c.amber}>2. Programar</Badge>
          </div>
          <div style={enter(frame, 8)}>
            <Title>
              El worker recuerda
              <br />
              <span style={{ color: c.amber }}>la próxima corrida.</span>
            </Title>
          </div>
          <div style={enter(frame, 16)}>
            <Copy>Persistencia, deduplicación, catch-up controlado y overlap seguro.</Copy>
          </div>
        </div>
        <div style={enter(frame, 16)}>
          <Window title="Durable scheduler" accent={c.amber}>
            <div style={{ padding: 38, display: "flex", flexDirection: "column", gap: 30 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}
              >
                <div>
                  <div style={{ fontSize: 25, color: c.muted }}>Próxima ejecución</div>
                  <div
                    style={{ fontSize: 64, fontWeight: 880, fontVariantNumeric: "tabular-nums" }}
                  >
                    09:00:00
                  </div>
                </div>
                <div
                  style={{
                    padding: "12px 19px",
                    color: c.green,
                    background: `${c.green}16`,
                    borderRadius: 99,
                    fontSize: 23,
                    fontWeight: 850,
                  }}
                >
                  worker healthy
                </div>
              </div>
              <div style={{ height: 22, borderRadius: 99, background: c.line, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: `linear-gradient(90deg, ${c.violet}, ${c.amber})`,
                  }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
                {[
                  ["overlap", "skip"],
                  ["catch-up", "latest"],
                  ["concurrency", "2"],
                ].map(([label, value], i) => (
                  <div
                    key={label}
                    style={{
                      ...enter(frame, 28 + i * 7),
                      padding: 22,
                      background: c.panel2,
                      borderRadius: 18,
                    }}
                  >
                    <div style={{ fontSize: 20, color: c.muted }}>{label}</div>
                    <div style={{ fontSize: 30, fontWeight: 850, marginTop: 7 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Window>
        </div>
      </div>
    </Scene>
  );
};

const Execute = () => {
  const frame = useCurrentFrame();
  const output = [
    "Starting Codex agent…",
    "Reading workspace context…",
    "Running daily research…",
    "✓ Result saved · agent done",
  ];
  return (
    <Scene index="04 / 06">
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "0.76fr 1.24fr",
          gap: 82,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={enter(frame, 0)}>
            <Badge color={c.green}>3. Ejecutar</Badge>
          </div>
          <div style={enter(frame, 8)}>
            <Title>
              La ejecución
              <br />
              <span style={{ color: c.green }}>se puede ver.</span>
            </Title>
          </div>
          <div style={enter(frame, 16)}>
            <Copy>
              Herdr abre o reutiliza un pane en el workspace correcto. Nada corre a oscuras.
            </Copy>
          </div>
        </div>
        <div style={enter(frame, 16)}>
          <Window title="auto:daily-research · Codex" accent={c.green}>
            <div
              style={{
                padding: 36,
                minHeight: 360,
                fontFamily: "SFMono-Regular, Menlo, monospace",
                fontSize: 25,
                lineHeight: 1.75,
              }}
            >
              <div style={{ color: c.violet, marginBottom: 18 }}>› Summarize today’s signals</div>
              {output.map((line, i) => (
                <div
                  key={line}
                  style={{
                    ...enter(frame, 28 + i * 18, 14),
                    color: i === output.length - 1 ? c.green : c.muted,
                  }}
                >
                  {i === output.length - 1 ? "" : "• "}
                  {line}
                </div>
              ))}
              <div
                style={{
                  marginTop: 24,
                  display: "inline-flex",
                  gap: 12,
                  alignItems: "center",
                  color: c.green,
                  fontFamily: base.fontFamily,
                  fontWeight: 850,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 99,
                    background: c.green,
                    boxShadow: `0 0 20px ${c.green}`,
                  }}
                />
                done
              </div>
            </div>
          </Window>
        </div>
      </div>
    </Scene>
  );
};

const Control = () => {
  const frame = useCurrentFrame();
  const keys = [
    ["n", "run now"],
    ["p", "pause"],
    ["t", "retry"],
    ["h", "history"],
  ];
  return (
    <Scene index="05 / 06">
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 88,
          alignItems: "center",
        }}
      >
        <div style={enter(frame, 12)}>
          <Window title="Herdr Automations · popup board" accent={c.cyan}>
            <div style={{ padding: 30 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr",
                  padding: "0 18px 13px",
                  color: c.muted,
                  fontSize: 20,
                  fontWeight: 760,
                }}
              >
                <div>Automation</div>
                <div>Trigger</div>
                <div>Next run</div>
                <div>Status</div>
              </div>
              {[
                ["Daily research", "cron weekday", "tomorrow 09:00", "succeeded", c.green],
                ["Inbox summary", "every 30m", "in 18m", "scheduled", c.cyan],
                ["Blocked alert", "Herdr event", "watching", "enabled", c.violet],
              ].map(([name, trigger, next, status, color], i) => (
                <div
                  key={name}
                  style={{
                    ...enter(frame, 24 + i * 8),
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr",
                    padding: "20px 18px",
                    borderTop: `1px solid ${c.line}`,
                    alignItems: "center",
                    fontSize: 21,
                  }}
                >
                  <div style={{ fontWeight: 820 }}>{name}</div>
                  <div style={{ color: c.muted }}>{trigger}</div>
                  <div>{next}</div>
                  <div style={{ color, fontWeight: 820 }}>{status}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 14, marginTop: 28 }}>
                {keys.map(([key, label]) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      gap: 9,
                      alignItems: "center",
                      color: c.muted,
                      fontSize: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 35,
                        height: 35,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 8,
                        background: c.panel2,
                        border: `1px solid ${c.line}`,
                        color: c.text,
                        fontWeight: 850,
                      }}
                    >
                      {key}
                    </div>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </Window>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={enter(frame, 0)}>
            <Badge>4. Observar y controlar</Badge>
          </div>
          <div style={enter(frame, 8)}>
            <Title>
              Estado, historial
              <br />
              <span style={{ color: c.cyan }}>y control manual.</span>
            </Title>
          </div>
          <div style={enter(frame, 16)}>
            <Copy>Run now, pause, retry, cancel seguro y diagnóstico desde un popup.</Copy>
          </div>
        </div>
      </div>
    </Scene>
  );
};

const Finale = () => {
  const frame = useCurrentFrame();
  return (
    <Scene index="06 / 06">
      <div
        style={{
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
        }}
      >
        <div style={enter(frame, 0)}>
          <Badge color={c.green}>Open source · Herdr 0.8+</Badge>
        </div>
        <div style={enter(frame, 8)}>
          <Title>
            Automatizaciones durables.
            <br />
            <span style={{ color: c.green }}>Agentes observables.</span>
          </Title>
        </div>
        <div style={{ ...enter(frame, 16), maxWidth: 1040 }}>
          <Copy>
            Cron, intervalos y eventos Herdr. Configuración declarativa. Ejecución visible. Control
            desde el board.
          </Copy>
        </div>
        <div
          style={{
            ...enter(frame, 26),
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "22px 30px",
            borderRadius: 20,
            background: c.panel,
            border: `2px solid ${c.line}`,
            fontFamily: "SFMono-Regular, Menlo, monospace",
            fontSize: 27,
          }}
        >
          <span style={{ color: c.muted }}>$</span>
          <span style={{ color: c.cyan }}>herdr plugin install</span>
          <span>ram4-dev/herdr-automations</span>
        </div>
      </div>
    </Scene>
  );
};

const timing = linearTiming({ durationInFrames: 12 });

export const HerdrAutomationsFeatureVideo = () => (
  <AbsoluteFill style={{ backgroundColor: c.bg }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={150}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <Configure />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={150}>
        <Schedule />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <Execute />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={150}>
        <Control />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
      <TransitionSeries.Sequence durationInFrames={210}>
        <Finale />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
