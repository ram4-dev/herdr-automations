import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

const colors = {
  bg: "#080A0F",
  panel: "#111722",
  line: "#263143",
  text: "#F7F9FC",
  muted: "#9EABC0",
  violet: "#8C7CFF",
  cyan: "#49D6E9",
  green: "#57E39B",
  amber: "#FFCA61",
  red: "#FF6B7A",
};

const font: CSSProperties = {
  fontFamily: "Inter, SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif",
  color: colors.text,
};

const rise = (frame: number, delay = 0) => ({
  opacity: interpolate(frame, [delay, delay + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  }),
  translate: `0 ${interpolate(frame, [delay, delay + 18], [44, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px`,
});

const Shell = ({ children, step }: { children: ReactNode; step: string }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        ...font,
        background:
          "radial-gradient(circle at 80% 12%, #25205B 0%, transparent 35%), radial-gradient(circle at 0% 78%, #0D3A43 0%, transparent 32%), #080A0F",
        padding: "110px 82px 96px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.18,
          backgroundImage:
            "linear-gradient(#FFFFFF0A 1px, transparent 1px), linear-gradient(90deg, #FFFFFF0A 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          translate: `${interpolate(frame, [0, 180], [0, -20])}px ${interpolate(frame, [0, 180], [0, -20])}px`,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 99,
              background: colors.violet,
              boxShadow: `0 0 30px ${colors.violet}`,
            }}
          />
          Herdr Automations
        </div>
        <div style={{ color: colors.muted }}>{step}</div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        {children}
      </div>
      <div
        style={{
          zIndex: 2,
          height: 5,
          borderRadius: 99,
          background: colors.line,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${interpolate(frame, [0, 180], [0, 100], {
              extrapolateRight: "clamp",
            })}%`,
            background: `linear-gradient(90deg, ${colors.violet}, ${colors.cyan})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const Tag = ({ children, color }: { children: ReactNode; color: string }) => (
  <div
    style={{
      alignSelf: "flex-start",
      padding: "14px 24px",
      borderRadius: 99,
      background: `${color}18`,
      border: `2px solid ${color}70`,
      color,
      fontSize: 30,
      fontWeight: 800,
      letterSpacing: 1,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Headline = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 100, lineHeight: 0.98, fontWeight: 850, letterSpacing: -5 }}>
    {children}
  </div>
);

const Subhead = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 46, lineHeight: 1.25, color: colors.muted, fontWeight: 550 }}>
    {children}
  </div>
);

const MailCard = ({ status, accent }: { status: string; accent: string }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        ...rise(frame, 22),
        borderRadius: 36,
        background: `${colors.panel}E8`,
        border: `2px solid ${colors.line}`,
        padding: 40,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        boxShadow: "0 40px 100px #00000070",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 34, fontWeight: 800 }}>Cada 10 minutos</div>
        <div
          style={{
            fontSize: 28,
            color: accent,
            background: `${accent}18`,
            padding: "10px 18px",
            borderRadius: 99,
            fontWeight: 800,
          }}
        >
          {status}
        </div>
      </div>
      <div style={{ height: 2, background: colors.line }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "150px 1fr",
          gap: "18px 20px",
          fontSize: 34,
        }}
      >
        <div style={{ color: colors.muted }}>Para</div>
        <div style={{ fontWeight: 700 }}>mi cuenta conectada</div>
        <div style={{ color: colors.muted }}>Asunto</div>
        <div style={{ fontWeight: 700 }}>Esto es una automatización</div>
      </div>
    </div>
  );
};

const Intro = () => {
  const frame = useCurrentFrame();
  return (
    <Shell step="01 / 05">
      <div style={{ display: "flex", flexDirection: "column", gap: 42 }}>
        <div style={rise(frame, 0)}>
          <Tag color={colors.cyan}>Caso real</Tag>
        </div>
        <div style={rise(frame, 8)}>
          <Headline>
            Una automatización
            <br />
            <span style={{ color: colors.cyan }}>parecía funcionar.</span>
          </Headline>
        </div>
        <div style={rise(frame, 16)}>
          <Subhead>Codex enviaba un email cada 10 minutos.</Subhead>
        </div>
        <MailCard status="1er envío ✓" accent={colors.green} />
      </div>
    </Shell>
  );
};

const Failure = () => {
  const frame = useCurrentFrame();
  return (
    <Shell step="02 / 05">
      <div style={{ display: "flex", flexDirection: "column", gap: 42 }}>
        <div style={rise(frame, 0)}>
          <Tag color={colors.red}>El problema</Tag>
        </div>
        <div style={rise(frame, 8)}>
          <Headline>
            El segundo envío
            <br />
            <span style={{ color: colors.red }}>quedó bloqueado.</span>
          </Headline>
        </div>
        <div style={rise(frame, 16)}>
          <Subhead>El scheduler seguía activo. Gmail esperaba una decisión.</Subhead>
        </div>
        <div
          style={{
            ...rise(frame, 24),
            background: colors.panel,
            border: `2px solid ${colors.red}80`,
            borderRadius: 36,
            padding: 42,
            display: "flex",
            flexDirection: "column",
            gap: 30,
            boxShadow: `0 0 80px ${colors.red}20`,
          }}
        >
          <div style={{ fontSize: 34, color: colors.muted }}>Allow Gmail to send an email?</div>
          {["Allow once", "Allow for this session", "Always allow"].map((label, index) => (
            <div
              key={label}
              style={{
                display: "flex",
                gap: 20,
                alignItems: "center",
                fontSize: 38,
                fontWeight: 700,
                color: index === 0 ? colors.amber : colors.muted,
              }}
            >
              <div style={{ width: 40, color: index === 0 ? colors.amber : colors.line }}>
                {index === 0 ? "●" : "○"}
              </div>
              {label}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
};

const Cause = () => {
  const frame = useCurrentFrame();
  return (
    <Shell step="03 / 05">
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={rise(frame, 0)}>
          <Tag color={colors.amber}>Causa raíz</Tag>
        </div>
        <div style={rise(frame, 8)}>
          <Headline>
            Un permiso
            <br />
            <span style={{ color: colors.amber }}>de un solo uso.</span>
          </Headline>
        </div>
        <div style={rise(frame, 18)}>
          <Subhead>La primera corrida fue exitosa. Eso no probaba recurrencia.</Subhead>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {[
            ["12:09", "Email enviado", colors.green, "✓"],
            ["12:19", "Esperando permiso", colors.red, "!"],
            ["12:29", "Ejecución omitida", colors.muted, "—"],
          ].map(([time, label, color, icon], index) => (
            <div
              key={time}
              style={{
                ...rise(frame, 28 + index * 8),
                display: "grid",
                gridTemplateColumns: "150px 70px 1fr",
                alignItems: "center",
                background: colors.panel,
                border: `2px solid ${colors.line}`,
                padding: "28px 32px",
                borderRadius: 28,
                fontSize: 36,
              }}
            >
              <div style={{ color: colors.muted, fontVariantNumeric: "tabular-nums" }}>{time}</div>
              <div style={{ color, fontWeight: 900 }}>{icon}</div>
              <div style={{ fontWeight: 700 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
};

const Fix = () => {
  const frame = useCurrentFrame();
  const items = [
    ["1", "Advertir", "Los permisos únicos no alcanzan para recurrencia."],
    ["2", "Autorizar", "Persistencia explícita y acotada a la acción."],
    ["3", "Verificar", "Esperar una segunda corrida sin intervención."],
  ];
  return (
    <Shell step="04 / 05">
      <div style={{ display: "flex", flexDirection: "column", gap: 42 }}>
        <div style={rise(frame, 0)}>
          <Tag color={colors.violet}>La solución segura</Tag>
        </div>
        <div style={rise(frame, 8)}>
          <Headline>
            No es “dar
            <br />
            <span style={{ color: colors.violet }}>más permisos”.</span>
          </Headline>
        </div>
        <div style={rise(frame, 16)}>
          <Subhead>Es dar el permiso correcto, con alcance explícito.</Subhead>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {items.map(([number, title, body], index) => (
            <div
              key={number}
              style={{
                ...rise(frame, 24 + index * 9),
                display: "grid",
                gridTemplateColumns: "78px 1fr",
                gap: 24,
                background: colors.panel,
                border: `2px solid ${colors.line}`,
                borderRadius: 30,
                padding: 30,
              }}
            >
              <div
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: 99,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: colors.violet,
                  fontSize: 34,
                  fontWeight: 900,
                }}
              >
                {number}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 40, fontWeight: 850 }}>{title}</div>
                <div style={{ fontSize: 31, lineHeight: 1.25, color: colors.muted }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
};

const Success = () => {
  const frame = useCurrentFrame();
  return (
    <Shell step="05 / 05">
      <div style={{ display: "flex", flexDirection: "column", gap: 46 }}>
        <div style={rise(frame, 0)}>
          <Tag color={colors.green}>Ahora sí</Tag>
        </div>
        <div style={rise(frame, 8)}>
          <Headline>
            Segunda corrida
            <br />
            <span style={{ color: colors.green }}>autónoma ✓</span>
          </Headline>
        </div>
        <div style={rise(frame, 16)}>
          <Subhead>Gmail completó el envío. El agente volvió a done. El scheduler avanzó.</Subhead>
        </div>
        <MailCard status="Recurrente ✓" accent={colors.green} />
        <div
          style={{
            ...rise(frame, 34),
            display: "flex",
            flexDirection: "column",
            gap: 14,
            textAlign: "center",
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: 42, fontWeight: 850 }}>La lección ya vive en la skill.</div>
          <div style={{ fontSize: 32, color: colors.cyan, fontWeight: 700 }}>
            github.com/ram4-dev/herdr-automations
          </div>
        </div>
      </div>
    </Shell>
  );
};

const timing = linearTiming({ durationInFrames: 15 });

export const AutomationPermissionsVideo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={210}>
          <Intro />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={timing}
        />
        <TransitionSeries.Sequence durationInFrames={210}>
          <Failure />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={210}>
          <Cause />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={timing}
        />
        <TransitionSeries.Sequence durationInFrames={210}>
          <Fix />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={270}>
          <Success />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Sequence from={0} durationInFrames={1050}>
        <div
          style={{
            position: "absolute",
            right: 82,
            bottom: 45,
            ...font,
            color: colors.muted,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          ram4.dev
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
