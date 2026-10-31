/*
  App-wide rule: charts appear instantly, never animated.

  Recharts animates every line, bar, area, pie slice and scatter dot by
  default — lines sweep in from the left, bars grow up from the axis, and
  everything morphs when the data changes. This app wants charts drawn in
  their final shape straight away, on desktop and phones alike.

  Rather than writing isAnimationActive={false} on every chart element (and
  forgetting it on the next chart someone adds), this file changes Recharts'
  own default once. Think of it as changing the factory setting instead of
  flipping the switch on each appliance. A chart can still opt back in by
  passing isAnimationActive={true} explicitly.

  The tooltip is included too, so it jumps to the hovered point instead of
  gliding there.

  How it works: in Recharts 2.x these components are classes that carry a
  `defaultProps` object, which React reads whenever a prop isn't passed.
  Importing this file once (PortfolioBacktester.tsx does it at the top) edits
  those objects before any chart renders.

  Recharts 3 dropped defaultProps. If the library is ever upgraded, the
  warning below fires in the browser console and this needs redoing.
*/

import { Line, Bar, Area, Pie, Scatter, Tooltip, Radar, RadialBar, Funnel, Treemap } from 'recharts';

// Every Recharts component that has an isAnimationActive setting.
const animated = { Line, Bar, Area, Pie, Scatter, Tooltip, Radar, RadialBar, Funnel, Treemap };

for (const [name, component] of Object.entries(animated)) {
  const defaults = (component as { defaultProps?: Record<string, unknown> }).defaultProps;
  if (defaults) {
    defaults.isAnimationActive = false;
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn(`noChartAnimation: Recharts ${name} has no defaultProps, so its animation is still on.`);
  }
}

export {};
