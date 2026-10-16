// Section heading above a group of tiles or rows. Carries the `header` role (Req 3.5).

import type { ReactNode } from "react";

import { AppText } from "./app-text";

export type SectionTitleProps = Readonly<{ children: ReactNode; className?: string }>;

export function SectionTitle({ children, className }: SectionTitleProps): React.JSX.Element {
  return (
    <AppText variant="heading" tone="primary" header className={className}>
      {children}
    </AppText>
  );
}
