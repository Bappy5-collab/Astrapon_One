import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { color, radius, tokens } from "@/theme/tokens";

const STEPS = [
  { title: "Read the answer", body: "“What the comparison found” names the option ranked first and the four tiles compare it with today's Boro + Aman rice: irrigation water, extra water in a dry year, bare days and crop variety." },
  { title: "Watch the seasons", body: "Open “Watch the seasons” to replay the field day by day on past NASA POWER weather: crops growing, soil drying, rain and irrigation, with a table for every fact." },
  { title: "Ask why", body: "“Why this option?” shows which of your priorities moved the ranking, the evidence used, the data gaps and the questions to check with a local adviser." },
  { title: "Check water and energy", body: "Further down: how much water each rotation would pump from a tube well, the pump power and energy, and the solar panels that would cover it — plus NASA GRACE regional water storage." },
];

/** A four-step reading guide for the public example (static, no state). */
export function ExampleGuide() {
  return (
    <Box component="section" aria-labelledby="ex-guide" sx={{ mb: 3, p: { xs: 2, md: 2.5 }, borderRadius: `${radius.lg}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }}>
      <Typography id="ex-guide" component="h2" variant="h6" sx={{ mb: 1.5, fontSize: "1.1rem" }}>
        How to read this example in two minutes
      </Typography>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
        {STEPS.map((s, i) => (
          <Box component="li" key={s.title} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
            <Box aria-hidden sx={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 800, bgcolor: tokens.lime[400], color: tokens.forest[950] }}>
              {i + 1}
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 700, mb: 0.25 }}>{s.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {s.body}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
