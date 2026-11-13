"use client";

import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { createTheme } from "@mui/material/styles";
import { createElement } from "react";

import { color, elevation, motion, radius, tokens } from "./tokens";

// Native date/month inputs: the browser draws the calendar popup itself, so only the field, its
// calendar icon (a forest-green SVG) and the accent colour can follow the theme.
const calendarIcon = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${tokens.forest[600]}'><path d='M19 4h-1V3a1 1 0 0 0-2 0v1H8V3a1 1 0 0 0-2 0v1H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 15H5V9h14v10ZM7 11h4v4H7z'/></svg>`,
)}")`;

/** Floating list surface shared by select menus, autocomplete lists and popovers. */
const floatingPaper = {
  marginTop: 6,
  borderRadius: radius.lg,
  border: `1px solid ${color.line}`,
  boxShadow: elevation.overlay,
  backgroundColor: tokens.neutral[50],
} as const;

/** One option row in any dropdown: rounded, lime when selected, soft green on hover/keyboard focus. */
const optionRow = {
  margin: "2px 6px",
  borderRadius: radius.sm + 2,
  minHeight: 40,
  paddingInline: 12,
  fontSize: "0.9375rem",
  color: color.ink,
  transition: `background-color ${motion.fast}ms`,
  "&:hover, &.Mui-focused, &.Mui-focusVisible": { backgroundColor: tokens.neutral[150] },
  "&.Mui-selected, &[aria-selected='true']": {
    backgroundColor: tokens.lime[200],
    color: tokens.forest[950],
    fontWeight: 600,
    boxShadow: `inset 3px 0 0 ${tokens.forest[600]}`,
    "&:hover, &.Mui-focused, &.Mui-focusVisible": { backgroundColor: tokens.lime[300] },
  },
  "&.Mui-disabled, &[aria-disabled='true']": { opacity: 0.5 },
} as const;

// Latin faces first; Bengali glyphs fall through to the Noto Bengali faces in the same stack.
const display = "var(--font-display), var(--font-bn-serif), Georgia, serif";
const body = "var(--font-body), var(--font-bn-sans), system-ui, -apple-system, 'Segoe UI', sans-serif";

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: tokens.forest[800], light: tokens.forest[500], dark: tokens.forest[950], contrastText: tokens.neutral[50] },
    secondary: { main: tokens.lime[400], light: tokens.lime[300], dark: tokens.lime[600], contrastText: tokens.forest[950] },
    background: { default: color.surface, paper: color.surfaceRaised },
    text: { primary: color.ink, secondary: color.inkMuted },
    divider: color.line,
    warning: { main: "#B7791F", dark: color.warning },
    error: { main: color.danger },
    success: { main: tokens.forest[500] },
    info: { main: tokens.forest[600] },
  },
  shape: { borderRadius: radius.md },
  typography: {
    fontFamily: body,
    h1: { fontFamily: display, fontWeight: 600, fontSize: "clamp(2.3rem, 4.6vw, 3.75rem)", lineHeight: 1.06, letterSpacing: "-0.02em" },
    h2: { fontFamily: display, fontWeight: 600, fontSize: "clamp(1.8rem, 3.2vw, 2.5rem)", lineHeight: 1.12, letterSpacing: "-0.015em" },
    h3: { fontFamily: display, fontWeight: 600, fontSize: "1.55rem", lineHeight: 1.2 },
    h4: { fontWeight: 700, fontSize: "1.25rem", lineHeight: 1.3 },
    h5: { fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.35 },
    h6: { fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.4 },
    subtitle1: { fontSize: "1.125rem", lineHeight: 1.6 },
    subtitle2: { fontSize: "0.95rem", fontWeight: 600, lineHeight: 1.45 },
    body1: { fontSize: "1rem", lineHeight: 1.65 },
    body2: { fontSize: "0.9375rem", lineHeight: 1.55 },
    caption: { fontSize: "0.8125rem", lineHeight: 1.45 },
    overline: { fontWeight: 700, letterSpacing: "0.12em", fontSize: "0.75rem", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
  },
  transitions: {
    duration: { shortest: motion.fast, shorter: motion.fast, short: motion.base, standard: motion.base, complex: motion.slow, enteringScreen: motion.base, leavingScreen: motion.fast },
    easing: { easeInOut: motion.easing, easeOut: motion.easing, easeIn: "cubic-bezier(0.3, 0, 1, 1)", sharp: motion.easing },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: radius.md, paddingInline: 18, minHeight: 40 }, sizeSmall: { minHeight: 32 }, sizeLarge: { minHeight: 48, paddingInline: 22 } },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: radius.md } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, borderRadius: radius.md } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: radius.sm } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { borderColor: color.line, borderRadius: radius.lg, boxShadow: elevation.raised } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: color.surfaceRaised,
          transition: `box-shadow ${motion.fast}ms`,
          [`&:hover:not(.Mui-disabled):not(.Mui-error) .MuiOutlinedInput-notchedOutline`]: { borderColor: tokens.forest[500] },
          "&.Mui-focused:not(.Mui-error)": { boxShadow: `0 0 0 3px ${tokens.lime[200]}` },
          "&.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline": { borderColor: tokens.forest[600] },
        },
        notchedOutline: { borderColor: tokens.neutral[500] },
        input: {
          "&[type='date'], &[type='month'], &[type='time'], &[type='datetime-local']": { colorScheme: "light", accentColor: tokens.forest[600], minHeight: "1.4375em" },
          "&::-webkit-calendar-picker-indicator": {
            backgroundImage: calendarIcon,
            backgroundSize: "18px 18px",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            color: "transparent",
            width: 22,
            height: 22,
            padding: 3,
            borderRadius: radius.sm,
            cursor: "pointer",
            opacity: 1,
          },
          "&::-webkit-calendar-picker-indicator:hover": { backgroundColor: tokens.lime[200] },
          "&::-webkit-datetime-edit-fields-wrapper": { fontVariantNumeric: "tabular-nums" },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { "&.Mui-focused:not(.Mui-error)": { color: tokens.forest[600] } } } },
    MuiSelect: {
      // Menus drop below the field (not over it), like every other dropdown in the app.
      defaultProps: {
        IconComponent: ExpandMoreRoundedIcon,
        MenuProps: { anchorOrigin: { vertical: "bottom", horizontal: "left" }, transformOrigin: { vertical: "top", horizontal: "left" }, slotProps: { paper: { elevation: 0 } } },
      },
      styleOverrides: {
        icon: { color: tokens.forest[600], transition: `transform ${motion.base}ms ${motion.easing}` },
        iconOpen: { transform: "rotate(180deg)" },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { ...floatingPaper, maxHeight: 360 },
        list: { paddingBlock: 4 },
      },
    },
    MuiMenuItem: { styleOverrides: { root: optionRow } },
    // Group headings inside a menu ("Suggested for this field", "All areas").
    MuiListSubheader: {
      styleOverrides: {
        root: { backgroundColor: tokens.neutral[50], color: tokens.forest[700], fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: "32px" },
      },
    },
    MuiPopover: { styleOverrides: { paper: { borderRadius: radius.lg } } },
    MuiAutocomplete: {
      defaultProps: { popupIcon: createElement(ExpandMoreRoundedIcon), slotProps: { paper: { elevation: 0 } } },
      styleOverrides: {
        paper: floatingPaper,
        listbox: { padding: "4px 0", maxHeight: 320, "& .MuiAutocomplete-option": optionRow },
        popupIndicator: { color: tokens.forest[600] },
        noOptions: { color: color.inkMuted, fontSize: "0.875rem" },
      },
    },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: "0.8125rem", backgroundColor: tokens.forest[950] } } },
    MuiLink: { defaultProps: { underline: "hover" }, styleOverrides: { root: { color: color.leaf } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: radius.md } } },
    MuiCssBaseline: {
      styleOverrides: {
        "::selection": { background: tokens.lime[300], color: tokens.forest[950] },
        ":focus-visible": { outline: `3px solid ${color.focus}`, outlineOffset: 2 },
        body: { WebkitFontSmoothing: "antialiased" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": { animationDuration: "0.01ms !important", animationIterationCount: "1 !important", transitionDuration: "0.01ms !important", scrollBehavior: "auto !important" },
        },
        // Printing a run prints its stored details; site chrome and controls are left out.
        "@media print": { "header, footer, nav, .no-print": { display: "none !important" }, body: { background: "#fff" } },
      },
    },
  },
});
