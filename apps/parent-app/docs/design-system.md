# Xelulu parent app: design system

Phases 2.1 and 2.2. Light theme only. Everything here is built to `docs/design/Xelulu Parent App UX Flow-4.png`, the frozen 16-screen reference.

`src/theme/tokens.json` is the single token source. It is the only file in the app allowed to hold a raw colour value. `tailwind.config.js` requires it (replacing Tailwind's colour, font-size, spacing and radius scales, so a non-token class such as `bg-white` does not exist), and `src/theme/theme.ts` re-exports it with types for the places that need a raw value: icon colours, `Switch` track colours, SVG fills and the card shadow. A repo check (`tooling/test/placeholder.test.ts`) fails on any colour literal, `dark:` class or `text-[Npx]` class outside the token source.

## Colour tokens

| Token | Value | Use |
|---|---|---|
| `page` | `#F7F1E8` | Page background (cream) |
| `surface` | `#FFFFFF` | Cards, tiles, tab bar, toggle thumb |
| `surface-beige` | `#F1E6D6` | Image wells, secondary button, icon tiles, pressed state |
| `hairline` | `#E6D9C6` | Card, tile and bar borders (decorative); the battery-bar track; the press fill of a secondary `Button`, an unselected `Chip` and an unselected segment |
| `text-primary` | `#2E2620` | Titles, body, list-row titles |
| `text-secondary` | `#5C5047` | Subtitles |
| `text-muted` | `#6B6057` | Muted lines, chevrons, inactive tab icon and label |
| `brand` | `#6B4A35` | Primary fill, active tab, quick-action icons, secondary-button text |
| `brand-pressed` | `#553A29` | Primary button, pressed |
| `on-brand` | `#FFFFFF` | Text and icons on a brand or danger fill |
| `success` | `#2E7D32` | Online and healthy-battery dot, toggle on track |
| `warning` | `#A15C00` | Low-battery dot (10–19 %) |
| `danger` | `#C62828` | Critical-battery dot (below 10 %), destructive actions later |
| `info` | `#2F6BC9` | The activities numeral on a stat tile |
| `sun` | `#B87A00` | Greeting and mood glyphs |
| `control-off` | `#8A7E72` | Toggle off track |
| `character-body` | `#FFF8EE` | Character placeholder: body and inner ears |
| `character-ear` | `#F3E3CB` | Character placeholder: outer ears |
| `character-face` | `#2A2420` | Character placeholder: face panel |
| `character-eye` | `#F4B860` | Character placeholder: eye arcs and smile |
| `illustration-sky` | `#F6E7CF` | Story thumbnail: sky |
| `illustration-hill` | `#8DB580` | Story thumbnail: hill |
| `illustration-figure` | `#9AA3AD` | Story thumbnail: elephant |
| `illustration-night` | `#2B3A55` | Illustrations: night sky in `space-scene` (Phase 2.2) |
| `scrim` | `#2E2620` | The dim behind `ConfirmDialog`, at `opacity.scrim` (Phase 2.2) |
| `tile-rose` | `#FBDCDC` | `IconTile tone="rose"` fill (Phase 2 cleanup) |
| `tile-sky` | `#D6E8FB` | `IconTile tone="sky"` fill |
| `tile-amber` | `#FBE3BF` | `IconTile tone="amber"` fill |
| `tile-mint` | `#D4EEDC` | `IconTile tone="mint"` fill |
| `tile-lavender` | `#E2DCFB` | `IconTile tone="lavender"` fill |
| `glyph-rose` | `#B3261E` | The glyph on a rose tile |
| `glyph-sky` | `#1A5FB4` | The glyph on a sky tile |
| `glyph-amber` | `#8A5200` | The glyph on an amber tile |
| `glyph-mint` | `#1E6B38` | The glyph on a mint tile |
| `glyph-lavender` | `#4C3BB8` | The glyph on a lavender tile |

The character and illustration tokens are graphic fills only. No text is ever drawn on them, so they carry no contrast pair. `scrim` is the one colour used with an opacity: `opacity.scrim` is `0.4`, and it lives in the token source for the same reason the colour does, so a dialog's dim cannot drift from screen to screen.

**Colour-key order is load-bearing for danger-toned text.** `tailwind.config.js` builds its `colors` map from `tokens.color` in file order, so `text-danger` and `AppText`'s own `text-text-primary` are both present on a danger-toned line and the later class wins the cascade. `text-primary` is listed before `danger` in `tokens.json`, which is why the Privacy delete-or-export label and the Device page's critical-battery row read red. Reordering the colour keys would silently turn them brown. Do not reorder them; `tokens.json` is JSON and cannot carry the warning itself, so it lives here.

## Typography tokens

Size, line height and weight travel together: one `text-<token>` class sets all three. The platform system font is used (SF Pro on iOS, Roboto on Android), so the app has no font dependency.

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `display` | 28 | 34 | 700 | Reserved for later hero screens |
| `title` | 22 | 28 | 700 | Screen titles and the Home greeting |
| `heading` | 17 | 22 | 600 | Card titles, section titles, button labels |
| `stat` | 22 | 28 | 600 | The value on a stat tile |
| `body` | 15 | 20 | 400 | Body copy, placeholder lines |
| `label` | 13 | 18 | 500 | Tile labels, subtitles, status-pill text |
| `caption` | 12 | 16 | 400 | Timestamps, tab-bar labels |

Every size is at least 12 pt (Req 1.5).

## Spacing, radius, shadow and size tokens

| Group | Token | Value | Use |
|---|---|---|---|
| Spacing (pt) | `0` / `1` / `2` / `3` / `4` / `5` / `6` / `8` / `10` / `12` | 0 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | A 4-pt scale. `5` (20) is the page's horizontal padding; `3` (12) is the gap between tiles |
| Radius (pt) | `sm` | 8 | Small chips and wells |
| | `md` | 12 | Buttons, icon tiles |
| | `lg` | 14 | Quick-action and stat tiles, image wells |
| | `xl` | 16 | Cards |
| | `pill` | 999 | Status pills, segmented tabs, round icon buttons |
| Shadow | `shadow` | colour `#6B4A35`, opacity 0.08, radius 8, offset y 2, elevation 2 | The one soft card shadow, used by Card, QuickActionTile and StatTile |
| Size (pt) | `touchMin` | 44 | Minimum touch target on every control |
| | `iconSm` | 18 | `Icon size="sm"` |
| | `icon` | 22 | `Icon size="md"` (default) |
| | `iconLg` | 24 | `Icon size="lg"` |
| | `tabBarHeight` | 64 | Tab bar height, before the bottom safe-area inset |
| | `controlMin` | 48 | `Button`, `TextField` and the Account screen's provider buttons (Phase 2 styling pass) |
| | `rowMin` | 56 | `ListRow` and Privacy's `DangerRow` (Phase 2 styling pass) |
| | `tileMin` | 76 | `QuickActionTile` (Phase 2 styling pass) |
| Font scale | `fontScale.denseMax` | 1.5 | The cap a Dense_Component applies |
| Opacity | `opacity.scrim` | 0.4 | The `ConfirmDialog` scrim |
| | `opacity.disabled` | 0.5 | A disabled `Button` and a `Stepper` control at a bound (Phase 2 styling pass) |

### Tailwind scale entries (Phase 2 styling pass)

`tailwind.config.js` **replaces** Tailwind's colour, fontSize, spacing and borderRadius scales from `tokens.json`, so a class only exists if the config makes it. These were appended under `theme.extend` — appended, never reordered, because the colour key order is load-bearing for `text-danger` winning the cascade (see the warning above the colour table).

| Scale | Entries | Resolves to | Classes |
|---|---|---|---|
| `width`, `height`, `minWidth`, `minHeight` | `touch` | `size.touchMin`, 44px | `w-touch`, `h-touch`, `min-w-touch`, `min-h-touch` |
| | `control` | `size.controlMin`, 48px | `min-h-control` |
| | `row` | `size.rowMin`, 56px | `min-h-row` |
| | `tile` | `size.tileMin`, 76px | `min-h-tile` |
| `opacity` | the whole `opacity` token block | 0.4 / 0.5 | `opacity-scrim`, `opacity-disabled` |

No new colour and no new radius was needed: `rounded-pill` already existed. **Five Contrast_Pairs were**, because the pass turned `hairline` and `surface-beige` into press *fills* with label text drawn on them. Three press tints reuse an already-listed pair (`on-brand` on `brand-pressed`, `text-primary` on `surface-beige`, `text-muted` on `surface-beige`); the rest are listed in the Contrast pairs section below, under "Pressed-state pairs".

## Contrast pairs

Every text, icon and control-boundary colour is listed against every background it is used on. Ratios are WCAG 2.x, computed by `tooling/checks/contrast.ts`; `tooling/test/contrast.test.ts` recomputes each one and fails if it drops below its minimum. 4.5:1 is required for text below the large-text size; 3:1 for large text, icons and control boundaries.

| Foreground | Background | Ratio | Minimum | Use |
|---|---|---|---|---|
| `text-primary` | `page` | 13.22 | 4.5 | Titles and body on the page |
| `text-primary` | `surface` | 14.85 | 4.5 | Titles and body on a card |
| `text-primary` | `surface-beige` | 12.04 | 4.5 | Text and icons on a beige well or secondary button |
| `text-secondary` | `page` | 6.94 | 4.5 | Subtitles on the page |
| `text-secondary` | `surface` | 7.80 | 4.5 | Subtitles on a card |
| `text-muted` | `page` | 5.44 | 4.5 | Muted lines on the page |
| `text-muted` | `surface` | 6.11 | 4.5 | Muted lines, chevrons and the inactive tab icon and label |
| `text-muted` | `surface-beige` | 4.96 | 4.5 | Muted text on beige |
| `brand` | `page` | 7.04 | 4.5 | Brand text and icons on the page |
| `brand` | `surface` | 7.91 | 4.5 | Active tab label, quick-action icons, card accents |
| `brand` | `surface-beige` | 6.41 | 4.5 | Secondary button text |
| `on-brand` | `brand` | 7.91 | 4.5 | Primary button text |
| `on-brand` | `brand-pressed` | 10.38 | 4.5 | Primary button text, pressed |
| `on-brand` | `danger` | 5.62 | 4.5 | Text on a danger fill |
| `info` | `surface` | 5.16 | 4.5 | Activities numeral on a stat tile |
| `success` | `surface` | 5.13 | 3 | Online and battery dot, toggle on track |
| `warning` | `surface` | 5.19 | 3 | Low-battery dot |
| `danger` | `surface` | 5.62 | 3 | Critical-battery dot (graphic, 3:1) |
| `sun` | `page` | 3.21 | 3 | Greeting glyph on the page |
| `sun` | `surface` | 3.61 | 3 | Mood glyph on a stat tile |
| `control-off` | `surface` | 3.96 | 3 | Toggle off track boundary |

Phase 2.2 added seven more, bringing the listed total to 28:

| Foreground | Background | Ratio | Minimum | Use |
|---|---|---|---|---|
| `danger` | `surface` | 5.62 | 4.5 | Danger-toned row title and trailing text, and the Privacy delete-or-export label, on a card (text, 4.5:1) |
| `danger` | `page` | 5.01 | 4.5 | The same danger-toned text on the page background (text, 4.5:1) |
| `control-off` | `page` | 3.52 | 3 | Pending step ring and inactive page dot on the page |
| `text-secondary` | `surface-beige` | 6.32 | 4.5 | Subtitle text inside a beige well or on a secondary control |
| `success` | `hairline` | 3.69 | 3 | Device battery bar fill on its track |
| `warning` | `hairline` | 3.73 | 3 | Device battery bar fill on its track, low |
| `danger` | `hairline` | 4.04 | 3 | Device battery bar fill on its track, critical |

The Phase 2 cleanup pass added the five category-tile pairs, bringing the listed total to 33:

| Foreground | Background | Ratio | Minimum | Use |
|---|---|---|---|---|
| `glyph-rose` | `tile-rose` | 5.10 | 3 | Category glyph on a rose `IconTile` (graphic, 3:1) |
| `glyph-sky` | `tile-sky` | 5.03 | 3 | Category glyph on a sky `IconTile` (graphic, 3:1) |
| `glyph-amber` | `tile-amber` | 5.12 | 3 | Category glyph on an amber `IconTile` (graphic, 3:1) |
| `glyph-mint` | `tile-mint` | 5.31 | 3 | Category glyph on a mint `IconTile` (graphic, 3:1) |
| `glyph-lavender` | `tile-lavender` | 6.04 | 3 | Category glyph on a lavender `IconTile` (graphic, 3:1) |

Each pastel pairs with a deeper glyph of the same hue, and every pairing clears 5:1, well above the 3:1 a non-text graphic is held to. No text is ever drawn on a pastel tile: the row's title sits beside the tile, on the card.

### Pressed-state pairs (Phase 2 styling pass)

Moving press feedback from a `style` callback into an `active:` class is what made these fills paint for the first time, so the pairs they create are now real and are listed. Five more, bringing the listed total to 38:

| Foreground | Background | Ratio | Minimum | Use |
|---|---|---|---|---|
| `brand` | `hairline` | 5.69 | 4.5 | Secondary `Button` label while pressed, on its `active:bg-hairline` fill (text, 4.5:1) |
| `text-primary` | `hairline` | 10.68 | 4.5 | Unselected `Chip` label while pressed, same fill (text, 4.5:1) |
| `text-secondary` | `hairline` | 5.61 | 4.5 | Unselected `SegmentedTabs` option label while pressed, same fill (text, 4.5:1) |
| `text-muted` | `hairline` | 4.40 | 3 | Unselected `Chip` trailing glyph while pressed, and the Device battery bar's neutral-tone fill on its track (graphic, 3:1) |
| `danger` | `surface-beige` | 4.56 | 4.5 | Privacy delete-or-export label and glyph while pressed, on its `active:bg-surface-beige` fill (text, 4.5:1) |

The primary `Button`, the selected `Chip` and the selected segment all press to `brand-pressed` under `on-brand` text, which was already listed at 10.38. `Card` and `ListRow` press to `surface-beige`, whose `text-primary` (12.04) and `text-muted` (4.96) pairs were already listed too. The `text-muted`/`hairline` row does double duty: it is also the Device battery bar's neutral tone on its track, which is why `device-screen.tsx` can say all four of its bar fills are listed pairs.

**Two `danger`/`surface` pairs coexist on purpose.** The same two colours are listed twice with different minimums because they do two different jobs: an 8 pt critical-battery dot is a graphic and needs 3:1, while a danger-toned row title is text below the large-text size and needs 4.5:1. Both pass at 5.62, and listing them separately is what records which rule each use is held to. `tooling/checks/contrast.ts` computes the ratio and `tooling/test/contrast.test.ts` compares it against the pair's `min`, not against the figure printed here.

**`hairline` has two jobs, and only one of them is unlisted.**

- **As a border, it has no pair, deliberately.** It is 1.39:1 on `surface`, which is decorative by design: a button, card, pill, tab or tab bar is bounded by its fill, named by its label and at least 44 pt tall, so the hairline adds polish rather than meaning. Listing it would fail the check for no accessibility gain. WCAG 1.4.11 on those controls is exactly the kind of judgement that needs assistive-technology testing and expert accessibility review, which is an open item for this phase and not a thing this table settles.
- **As a press fill, it is listed.** Since the Phase 2 styling pass, `active:bg-hairline` paints the secondary `Button`, the unselected `Chip` and the unselected segment while they are held, with label text drawn straight on it, and it is also the Device battery bar's track. Three text pairs and one graphic pair follow from that, all in "Pressed-state pairs" above. The border reasoning grants no exemption here: wherever `hairline` carries text or a glyph, the pair is listed and `tooling/test/contrast.test.ts` recomputes it.

The reference's light-grey secondary and muted greys were darkened to reach these ratios (C8): accessibility wins over pixel-closeness. Status is never carried by colour alone; a status pill always renders its label next to its dot, a battery bar always prints its percentage, and every segmented option reports `accessibilityState.selected` as well as a brand fill.

These checks cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert accessibility review.

## Font scaling

System font scaling stays on for every text element. `AppText` never sets `allowFontScaling`.

The cap rule: only a **Dense_Component** passes `dense` to `AppText`, which sets `maxFontSizeMultiplier` to `fontScale.denseMax` (1.5). The Dense_Components are `QuickActionTile`, `StatTile` and `TabBar` — the three places where four or five items share one row and unbounded growth would push content off screen. Everywhere else text grows with the system setting and wraps; tiles carry minimum heights, never fixed heights. A repo check fails if `maxFontSizeMultiplier` or `dense` appears outside `app-text.tsx` and those three files.

Phase 2.2 added fifteen screens and eleven components and **extended the allow-list by nothing**. The check is per file and case-sensitive, and it matches the word anywhere in the file including inside a comment, so a new file that merely mentions a Dense_Component in prose fails it. Write "Dense_Component" with the capital when the concept has to be named.

## Component kit (`src/components/`)

One component per file. Every component accepts an optional `testID`. Every pressable control carries an accessibility role and label and reserves at least 44×44 pt. A pressed state is a colour or opacity change only: there is no animation anywhere in the app (C15), and nothing flashes (safety.md s.6).

| Component | Props | When to use it |
|---|---|---|
| `AppText` (`app-text.tsx`) | `variant: TypographyToken`, `tone?: "primary" \| "secondary" \| "muted" \| "brand" \| "info" \| "on-brand"`, `header?`, `dense?`, `className?`, `numberOfLines?`, `children` | Every piece of text. `header` gives it the `header` role; `dense` is for Dense_Components only |
| `Icon` (`icon.tsx`) | `name: IconName`, `size?: "sm" \| "md" \| "lg"`, `color?: ColorToken`, `decorative?` | Every glyph. Ionicons via `@expo/vector-icons`. `decorative` hides it from accessibility when adjacent text already says it |
| `Card` (`card.tsx`) | `children`, `padded?`, `className?`, plus `onPress` with a required `accessibilityLabel` | Any white rounded container. Give `onPress` only when the whole card opens something; it then carries the `button` role |
| `Button` (`button.tsx`) | `label`, `onPress`, `variant?: "primary" \| "secondary"`, `disabled?`, `icon?`, `accessibilityHint?`, `className?` | A full-width action at the bottom of a sheet or form. Primary for the main action, secondary for the alternative |
| `Toggle` (`toggle.tsx`) | `value`, `onValueChange(next)`, `accessibilityLabel`, `disabled?` | An on/off setting. Usually inside a `ListRow`'s `trailing` |
| `IconTile` (`icon-tile.tsx`) | `icon`, `tone?: IconTileTone` = `"beige" \| "surface" \| "rose" \| "sky" \| "amber" \| "mint" \| "lavender"` | The 40×40 leading tile of a list row. Decorative; the row title carries the meaning. See "Category tiles" |
| `ListRow` (`list-row.tsx`) | `title`, `subtitle?`, `icon?`, `iconTone?: IconTileTone`, `leading?: ReactNode`, `trailingText?: string`, `tone?: "default" \| "danger"`, `trailing?: "chevron" \| "none" \| { toggle: ToggleProps }`, `onPress?` | Settings-style rows (screens 11, 12, 13, 16). With `onPress` it becomes a button labelled by its title |
| `StatusPill` (`status-pill.tsx`) | `tone: "success" \| "warning" \| "danger" \| "neutral"`, `label`, `className?` | Online state, battery, mood — anywhere a state needs a dot plus words |
| `SegmentedTabs` (`segmented-tabs.tsx`) | `options: readonly { key, label }[]`, `value`, `onChange(key)`, `accessibilityLabel` | An in-page filter such as "All / Games / Stories / Learning". Container is a `tablist`; each option is a `tab` and only the active one reports `selected`. See "The selected segment" |
| `SectionTitle` (`section-title.tsx`) | `children`, `className?` | The heading above a group of tiles or rows. Carries the `header` role |
| `QuickActionTile` (`quick-action-tile.tsx`) | `icon`, `label`, `onPress` | A square shortcut tile in a row of four. Dense_Component |
| `StatTile` (`stat-tile.tsx`) | `value: { text, tone? } \| { icon, color }`, `label` | A non-pressable summary tile. Read as one element, "<value> <label>". Dense_Component |
| `Screen` (`screen.tsx`) | `children`, `scroll?` | The frame of every screen: cream page, top safe-area edge, page padding |
| `ScreenHeader` (`screen-header.tsx`) | `title`, `back?` | The header of a screen that is not Home. Back goes to the previous screen, or to `/home` when the screen was deep-linked |
| ~~`PlaceholderScreen` (`placeholder-screen.tsx`)~~ | ~~`route: ShellRouteKey`~~ | **Removed in Phase 2.2.** It drew every route that was not yet built; see the note below the table |
| `TabBar` (`tab-bar.tsx`) | `items: readonly { key, label, icon, iconActive }[]`, `activeKey`, `onSelect(key)` | The bottom bar, wired to Expo Router in `app/(tabs)/_layout.tsx`. Each item is a `tab` with its `selected` state. Dense_Component |

`PlaceholderScreen` was **deleted in Phase 2.2**, along with the shell's `PLACEHOLDER_LINE` string. Every one of the sixteen screens is now built, so a component whose whole job was to say "not built yet" had no caller left, and leaving it in the kit would invite a seventeenth route with no screen behind it.

### Kit additions (Phase 2.2)

Eleven components, one per file, under the same rules as above: an optional `testID`, a role and label on every control, at least 44×44 pt of touch area, a colour-or-opacity pressed state and no animation anywhere. The kit is closed at these eleven; a screen that needs something else composes it locally (see "Screen-local compositions").

| Component | Props | When to use it |
|---|---|---|
| `TextField` (`text-field.tsx`) | `value`, `onChangeText(next)`, `label?`, `placeholder?`, `icon?: IconName`, `trailingIcon?: IconName`, `secure?`, `keyboardType?: "default" \| "email-address" \| "numeric"`, `autoCapitalize?: "none" \| "sentences" \| "words"`, `autoCorrect?`, `maxLength?`, `errorText?`, `editable?` | Every text input (screens 3, 5, 10, 12, 13). The accessible name is `label ?? placeholder`; `errorText` is also the `accessibilityHint`. `trailingIcon` is **decorative**: a glyph inside the field at its right edge in `text-muted`, hidden from accessibility, never pressable, and ignored when `secure` is set because the 44×44 reveal control owns that slot |
| `Chip` (`chip.tsx`) | `label`, `selected?`, `onPress?`, `trailing?: "none" \| "remove" \| "add"`, `accessibilityLabel?` | A small selectable or removable token: languages, interests, gender (screen 5). `selected` is a brand fill **and** `accessibilityState.selected` |
| `Avatar` (`avatar.tsx`) | `name`, `illustration?: IllustrationName`, `size?: "sm" \| "lg"` (40 / 96 pt), `accessibilityLabel?` | A person's picture or initial: Family rows and cards, the Child Profile hero. Falls back to the first letter of `name` with a built label; with an `illustration` it takes the `image` role |
| `Stepper` (`stepper.tsx`) | `value`, `min`, `max`, `step`, `onChange(next)`, `label`, `format(value)` | A numeric setting with no slider dependency — Volume on screen 11. `accessibilityRole="adjustable"` with `accessibilityValue` min/max/now/text; the value is always visible through `format`; the control at a bound is disabled |
| `CircleButton` (`circle-button.tsx`) | `icon`, `stateText?`, `size?: "badge" \| "lg"` (40 / 64 pt disc, default `lg`), `tone?: "neutral" \| "danger"`, `onPress`, plus either `label` or `accessibilityLabel` | The call controls on screen 7 and the photo badge on screen 5. The prop type is a two-arm discriminated union on `label`/`accessibilityLabel`, so `tsc` rejects a button with neither and an unlabelled badge cannot ship without an accessible name |
| `StepList` (`step-list.tsx`) | `steps: readonly { key, title, icon: IconName }[]`, `currentIndex` | The pairing steps on screen 4. The three states differ by **shape** as well as colour: a done circle is `checkmark` on a `brand` fill, a current circle is the step's own glyph ringed in `brand`, a pending one the same glyph ringed in `control-off`. Each row's accessibility label carries its state word |
| `PageDots` (`page-dots.tsx`) | `count`, `index`, `onSelect?(next)`, `accessibilityLabel?` | Carousel position: decorative on screen 1, interactive on screen 2. See the two modes below |
| `MediaCard` (`media-card.tsx`) | `title`, `subtitle`, `illustration: IllustrationName`, `onPress` | A content card with art, a title and a line under it (screens 8 and 13). One `button`, labelled by its title |
| `MetricRow` (`metric-row.tsx`) | `icon`, `iconTone?: IconTileTone`, `title`, `subtitle`, `value` (already formatted), `tone?: "info" \| "primary"` | A progress row on screen 9. Read as one accessibility element; draws **no divider** |
| `MetricTile` (`metric-tile.tsx`) | `icon`, `iconTone?: IconTileTone`, `value` (already formatted), `label` | A summary tile on screen 15. Read as one accessibility element; draws **no divider** |
| `ConfirmDialog` (`confirm-dialog.tsx`) | `visible`, `title`, `body`, `cancelLabel`, `actions: readonly { key, label, tone? }[]`, `onCancel()`, `onAction(key)` | The one place the app asks before something irreversible: screen 14's delete-or-export. A `transparent` `Modal` with `animationType="none"`, a `scrim` dim at `opacity.scrim`, `accessibilityRole="alert"`, `accessibilityViewIsModal`, and exactly one handler call per press |

**`CircleButton`'s touch slop is clamped, and the clamp is load-bearing.** It is `Math.max(0, (tokens.size.touchMin - DISC[size]) / 2)`, which gives the 40 pt `badge` 2 pt per side and the 64 pt `lg` **none**. Without the clamp the `lg` default computes −10, and a negative `hitSlop` *shrinks* the touch box — including the label's, because the disc, the label and `stateText` are one `Pressable`. `test/components.test.tsx` asserts the slop is 0 or absent for `lg` and 2 for `badge`, so the clamp cannot be dropped quietly.

**`PageDots` has two modes with different spacing.** Decorative (`onSelect` omitted): dots sit in a row at `gap` spacing 2, the container is `accessible={false}` with `importantForAccessibility="no-hide-descendants"`, and nothing is pressable. Interactive (`onSelect` given): each 8 pt dot is centred in its own **44×44 pt `Pressable`** with the `tab` role, `accessibilityState.selected` and the label "Page N of M", and the containers sit edge to edge with no gap and **no `hitSlop`**. A `hitSlop` is the wrong tool here: 18 pt per side would overlap both neighbours' centres, so which dot a tap selected would depend on z-order. The visible cost is that interactive dots sit further apart than the reference draws them — three dots take 132 pt — which is a recorded deviation, not a mistake.

**`MetricRow` and `MetricTile` live one per `Card`.** Neither draws a divider and neither expects one, because the reference draws screens 9 and 15 as separate cards rather than a grouped list. Screen 10 is the exception that proves the rule: its six routine rows share one `Card` with a `hairline` divider between them.

### Category tiles (Phase 2 cleanup)

`IconTile` draws the Reference's per-category pastels instead of beige everywhere. `tone` names the category colour; **`beige` is still the default**, so a caller that does not opt in renders exactly as it did before. Each pastel carries a deeper glyph of the same hue, both from `tokens.json`, and each pairing is a listed Contrast_Pair at the 3:1 graphic minimum (see the table above). The tile stays decorative: its glyph is hidden from accessibility because the row text beside it already names the row.

`ListRow`, `MetricRow` and `MetricTile` pass the tone straight through as `iconTone`, so a screen never reaches past them into the tile.

| Tone | Where it is used |
|---|---|
| `rose` | Grow's Language row; Reports' "Stories heard" and "Questions asked" tiles; Routines' Meals |
| `sky` | Grow's Reading row; Routines' Brushing; Notifications' "New memory saved" |
| `amber` | Grow's Curiosity row; Reports' "Play sessions" tile; Routines' Morning and Play Time; Notifications' "Play time completed" |
| `mint` | Grow's Physical Play row; Reports' "New words" tile; Device's Movement and Software & Health rows; Notifications' "Xelulu is charging" |
| `lavender` | Routines' Wind Down and Bedtime; Notifications' "Bedtime routine starting" and "Software update available" |
| `beige` (default) | Everything else: Device's Volume, Quiet Hours, Camera and Sleep / Wake rows, Grandma Mode, Privacy, Family, Settings, Grow's milestones and reports rows, and every locally added routine. The Reference draws these neutral too |

#### The Device screen's tile rule (Phase 2 styling pass)

**Rule: on screen 11 a row carries a pastel tone only where the Reference draws a distinct hue. That is the two green rows — Movement and Software & Health, both `mint` — and nothing else. The other four rows keep the default beige.** One rule for the whole screen; no per-row exception, and no "pending" row.

The six tile fills were sampled from the magnified Reference (an interior strip of each tile, away from the glyph):

| Row | Sampled fill | Reads as | Tone applied |
|---|---|---|---|
| Movement | pale green | a distinct hue | `mint` |
| Volume | warm neutral grey | neutral | `beige` |
| Quiet Hours | warm cream | neutral | `beige` |
| Camera (not included on this model) | warm cream | neutral | `beige` |
| Sleep / Wake | warm cream, about 2–3% warmer than Camera's | neutral | `beige` |
| Software & Health | pale yellow-green | a distinct hue | `mint` |

Sleep / Wake was the open question: the previous pass left it beige "until Omar confirms it in Expo Go". Sampling settles it. Its fill sits inside the same narrow neutral band as Volume, Quiet Hours and Camera — all four are within a few percent of each other and of the card behind them — while the two green rows sit visibly outside it in hue, not just in lightness. A 2–3% warmth difference is below a category distinction and is consistent with the Reference's soft rendering, so reading it as a deliberate per-function tone would invent a tone the Reference does not draw. Sleep / Wake is therefore `beige`, consistent with the three other neutral rows, and the screen needs no new token and no new Contrast_Pair.

The alternative rule — a per-function pastel on all six rows — was rejected: it would put four tones on the screen that the Reference does not draw, and it would make the two rows the Reference *does* colour stop standing out.

A row's tone is data where the row is data: `RoutineRow`, `NotificationRow`, `GrowMetric` and `ReportTile` each carry an `icon_tone` field beside `icon`, in the Mock_Module that already holds the glyph name. Device's two mint rows pass the tone inline, because that screen's rows are written out one by one.

### The selected segment (Phase 2 cleanup)

**The selected option of a `SegmentedTabs` is the control's most prominent element**: a filled `brand` pill with `on-brand` text, with the unselected options unfilled and `text-secondary` on the container's beige well. `SEGMENT_STATE` in `segmented-tabs.tsx` holds both pairs, so a test can read what the control applies rather than restating its classes.

**A fill is a class, never a `style` callback.** NativeWind takes over the `style` prop of any element carrying a `className`, so a `Pressable`'s style-as-function is never invoked ([nativewind issue 1105](https://github.com/nativewind/nativewind/issues/1105)). Phase 2.1 put the `brand` fill in that callback: the fill never painted, the white label sat on the beige container at about 1.2:1, and the selected option read as the lightest and lowest-contrast one. The rule below generalises this to the whole app.

### Pressed states are classes, not `style` functions (Phase 2 styling pass)

**Rule: an element that carries a `className` may carry a *static* `style` object, but never a `style` function.** Press feedback is an `active:` variant class; a disabled state is a conditional `opacity-*` class; a sizing or a fill is a class. Where a state must not apply, the variant class is left out of the composed class string rather than being suppressed inside a callback — so a disabled `Button` and a `Stepper` control at a bound compose in no `active:` class at all and cannot darken under a touch.

**What was verified, and how.** Against the pinned nativewind 4.2.7 / react-native-css-interop 0.2.7, both by reading `dist/runtime/native/native-interop.js` and by rendering a probe through the app's own Jest transform:

- **A style FUNCTION is dropped and never invoked.** The interop builds a fresh props object from the class declarations plus the inline ones; `collectInlineRules` knows only how to merge a style object or an array of them, and `applyRules` spreads a non-rule entry with `{ ...declaration }`, which on a function yields nothing. The probe's style function recorded **zero** calls, and the rendered node's `style` was the class-derived fill with the function's own enumerable properties spread in. Anything expressed inside the callback — a fill, a shadow, a 44 pt box, a disabled opacity — never reaches the device.
- **A static style object IS merged, and wins.** The probe's `<Pressable className="bg-brand" style={{ minHeight: 44 }}>` rendered `{ backgroundColor: "#6b4a35", minHeight: 44 }`; inline entries sort at `inlineSpecificity`, above class rules. This is why `segmented-tabs.tsx` may keep `style={SEGMENT_BOX}` and why `cardShadow` may stay inline.
- **`active:` really fires.** Pressing the probe swapped `backgroundColor` from `bg-brand` to `active:bg-brand-pressed` and left the other declarations alone.
- **Under Jest the interop is inert.** `wrap-jsx.js` skips registering the interop components when `NODE_ENV` is `"test"`, so class names arrive on the tree as plain props and never become styles. That is why these tests assert the rendered *classes* (resolved through the Tailwind box scale in `test/components.test.tsx`) rather than resolved pixel styles, and it is the reason the original defect was invisible to the suite: a test calling the style callback itself passed while the device rendered nothing.

**The one value that stays inline.** `cardShadow` (`shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset`, `elevation`) has no faithful class under this config, so `Card` and `QuickActionTile` pass it as a static `style` object. `TabBar`'s own height is inline too, because it depends on the measured safe-area inset. `CircleButton` is the one place a `pressed` value still drives a style: it reaches the disc through `Pressable`'s **children-as-function**, a prop NativeWind does not touch, and the disc's style is a static array — so unlike a `style` callback it really does run.

**The guard.** `tooling/test/style-props.test.ts` scans `apps/parent-app/app/**` and `src/**` and fails when an element carries both a `className` and a `style` whose value is a function — arrow, `function (…)`, a locally declared name bound to one, or a **member** of a local object literal whose property holds one (`style={PRESS.tint}` with `const PRESS = { tint: ({ pressed }) => … }`, in both the `key:` and the method-shorthand spelling). An object of press callbacks is the likeliest way the pattern would come back, so the scan resolves it rather than reading `PRESS.tint` as a plain value. A function reached through an **import** is the one documented residual gap: the scan cannot follow a name across files, which is why the ban is also written here as a convention and not left to the guard alone. It needs its own brace-aware JSX tag reader, because `placeholder.test.ts` reads opening tags with `[^>]*` and stops at the `>` of an `=>`. It is comment- and string-aware, asserts the scanned file list is non-empty and that some element really does carry both props, and carries a detector-sanity block proving it fires on each spelling of the function form and not on a static object, a static array, a call returning a style, a member holding a static object, a style function without a `className`, or another `*Style` prop.

**Converted in this pass:** `card.tsx`, `button.tsx`, `stepper.tsx` (two controls), `text-field.tsx`, `screen-header.tsx`, `list-row.tsx`, `tab-bar.tsx`, `chip.tsx`, `quick-action-tile.tsx`, `features/shell/screen-title.tsx`, `features/home/home-dashboard.tsx`, `features/talk/live-call-screen.tsx`, `features/privacy/privacy-screen.tsx`, `features/setup/account-screen.tsx`.

### The four additive `ListRow` props

- **`leading`** replaces the leading `IconTile` with any node, usually an `Avatar`. It is ignored when `icon` is set.
- **`iconTone`** is the leading tile's category colour, passed through to `IconTile`. Omitted, the tile is beige.
- **`trailingText`** is the text before the chevron or `Toggle`: a time, a value, "Later phase". It joins the row's accessibility label as `"<title>, <trailingText>"` **only on a pressable row**. On a non-pressable row it renders as its own `AppText` and is announced in document order; the row adds no `accessible` wrapper and no `accessibilityLabel`, because wrapping it would merge the title, subtitle and trailing text into a single announcement. Every `trailingText` consumer in Phase 2.2 except Routines is non-pressable.
- **`tone="danger"`** tints the **title and `trailingText`** and nothing else. It deliberately does not tint the leading glyph: an `IconTile`'s glyph follows its own `iconTone`, which keeps the two decisions apart. A row that wants some other graphic passes `leading={<Icon name="…" color="danger" decorative />}` instead.

With none of the four set, a `ListRow` renders exactly as it did in Phase 2.1.

### Danger-toned text

**Danger-toned text is `<AppText variant="…" className="text-danger">`, never a new `TextTone` member.** `AppText`'s tone union is `primary | secondary | muted | brand | info | on-brand` and it stays that way, so `tone="danger"` fails `tsc`. The class exists because `tailwind.config.js` derives `colors` from `tokens.color`, so it carries no colour literal and the token scan stays green. See the colour-key-order warning above: the class only wins the cascade because `text-primary` is listed before `danger` in `tokens.json`.

### Screen-local compositions

Not everything belongs in the kit. Two pieces live in a feature or in the shell on purpose.

- **`DangerRow`**, in `src/features/privacy/privacy-screen.tsx`. The DPDP delete-or-export surface is one `Pressable` with a danger-toned label and a chevron, and it exists on exactly one screen. A `ListRow` could not carry it, because its label needs the danger class on a `Pressable` of its own; a kit component for one caller would be a worse trade than eight lines in the screen that owns it.
- **`ScreenTitle`** and **`goBack()`**, in `src/features/shell/`. `ScreenTitle` composes an optional back control, the title line or lines inside one `header`-role wrapper, and an optional trailing control (the Live View gear). It is shell, not kit, because the kit is closed at its eleven additions and `ScreenHeader` may not gain props. Its `align?: "start" | "center"` prop defaults to `"start"` and renders the accessible header wrapper as `flex-1` plus `items-start` or `items-center`; screens 1 to 5 pass `align="center"`, and without the prop there would be no way to centre those five headings but to invent a per-screen wrapper. `goBack()` goes back when there is somewhere to go back to and lands on `/home` otherwise. `screen-header.tsx` keeps its own copy of those four lines because an existing kit component may not be edited; the duplication is deliberate and recorded here.

### Two rules that bind every screen

- **Every `SegmentedTabs` takes its feature's `segmentsLabel` string as its required `accessibilityLabel`.** The six are "Play categories", "Growth sections", "Family groups", "Privacy sections", "Report period" and "Notification kinds", each in its feature's `strings.ts`. The same string is how a test scopes itself to one segmented control, because the Tab_Bar and `SegmentedTabs` both render `accessibilityRole="tab"` with `accessibilityState.selected`: a whole-screen count of selected tabs sees two on `/play`, `/grow` and `/family`, and a whole-screen count of tabs sees nine on `/play`.

  The scope is resolved by **`getByLabelText(segmentsLabel)`**, through the `expectOneSelectedSegment` helper in `test/segments.test.tsx` — not by `getByRole("tablist", { name })`, which the phase's design originally specified. That query is unreachable here: RNTL's role query only matches an element whose `accessible` prop is set, and `segmented-tabs.tsx` deliberately leaves the container's unset so each option stays an accessibility element of its own. Marking the container `accessible` would collapse the options into one element and hide them from a screen reader, so it stays unset; the scoping intent is identical either way, and the Tab_Bar's own five tabs are counted by `TAB_LABEL` name rather than by role for the same reason.
- **`CharacterPlaceholder` always exposes the `image` role with the label "Xelulu robot".** It offers no way to hide itself, so it is never described as decorative, and any art placed beside it — a `PersonFigure` in a hero well, say — is the piece that stays decorative by taking no `accessibilityLabel`.

Feature strings live in the feature's `strings.ts` (`src/components/strings.ts`, `src/features/shell/strings.ts`, and one per feature under `src/features/`), so `src/lib/i18n` can replace them later. One exception is worth knowing before i18n starts: **`MOCK_CALL.status_label` and `MOCK_CALL.duration_label`** (`src/features/talk/mock-call.ts`) hold user-facing text inside a Mock_Module rather than in a `strings.ts`. They are there because they stand in for values a real session will supply, not for copy, but they are English text on screen today and i18n has to account for a second string home. The second one, screen 15's `interests_label`, is gone: Phase 4 replaced it with the Content_Category labels in `GROW_STRINGS.categories`, joined by the reports In_App_Store. A smaller note in the same direction: the design names the Grandma row strings `voiceCallRow` and friends while the code nests them as `GRANDMA_STRINGS.rows.call`; the code's shape is the one to follow.

## Asset licences

| Asset | Licence |
|---|---|
| `src/character/character-placeholder.tsx` (Character_Placeholder) | Original work, Xelulu-owned. No third-party art. Drawn in-repo with `react-native-svg`. Rive replaces the drawing later behind the same props |
| `src/features/home/story-thumbnail.tsx` (Last Activity thumbnail) | Original work, Xelulu-owned. No third-party art. Drawn in-repo with `react-native-svg`. Phase 2.1; it stays in the home feature rather than moving to `src/illustrations/` |
| `src/illustrations/play-scene.tsx` | Original work, Xelulu-owned. No third-party art |
| `src/illustrations/story-scene.tsx` | Original work, Xelulu-owned. No third-party art |
| `src/illustrations/person-figure.tsx` | Original work, Xelulu-owned. No third-party art |
| `src/illustrations/space-scene.tsx` | Original work, Xelulu-owned. No third-party art |
| `src/illustrations/dino-scene.tsx` | Original work, Xelulu-owned. No third-party art |
| Ionicons, via `@expo/vector-icons` | MIT |

No other image, font or animation file ships with the app in this phase. Fonts are the platform's own. Every future `.riv` or Lottie file gets its own licence line here before it is added.

The five illustrations are reached through one registry, `src/illustrations/illustration.tsx`: `ILLUSTRATION_NAMES`, the `IllustrationName` union and `<Illustration name width height accessibilityLabel? />`. Each art file draws with `react-native-svg`, takes its fills from `theme.ts` only, carries the licence line "Original work, Xelulu-owned. No third-party art." as its first comment, and holds no animation and nothing that could flash. Art is **decorative by default** — omit `accessibilityLabel` and the adjacent text names it — and takes the `image` role only when a label is given. Two repo checks hold this up: every file under `src/illustrations` must contain the licence line, and no `.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.riv` or `.lottie` file may exist anywhere under `apps/parent-app`.

## Notes carried into Phase 3

- **The D6 age-stage ranges (0–2 `tiny`, 3–5 `little`, 6–8 `explorer`, 9+ `maker`) are the app's assumption.** `product.md` names the stages but not the ranges. They match `deriveAgeStage` in `packages/shared`, and both change together if the product documents later name different ones. `src/features/setup/age-stage.ts` is an app-local copy for this phase and Phase 3 deletes it in favour of the shared function.
- **Volume is stepped, not dragged.** Screen 11 uses the kit `Stepper` where the reference draws a slider, because a usable accessible slider means a new runtime dependency and this phase adds none. The reference's percentage is kept, and the step is 5.
- **Family's "4 years" is a static label while Child Profile derives the stage live.** Family shows the reference's string; screen 5 computes the age stage from the typed date against today. Both are built as specified, so the two disagree the moment the mock date passes a birthday. The inconsistency is deliberate and documented; Phase 3 replaces both with one real value.
- **Both actions in screen 14's confirmation yield the same mock line.** Delete and export each show copy that says nothing happened, which is the honest thing for a mock to say but not what a real surface should say. Phase 3 gives each action its own result copy alongside the real deletion and export.
- **Real consent capture, deletion and export arrive with the backend.** This phase builds the surface, the confirmation step and copy that never claims an action it did not perform. DPDP s.9 on reports and cry alerts remains an open item for legal review.
