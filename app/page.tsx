/*
  MAIN PAGE

  This is the entry point - the first page users see when they visit your app.
  In Next.js App Router, `page.tsx` files define routes:
  - app/page.tsx -> yoursite.com/
  - app/about/page.tsx -> yoursite.com/about

  This page simply renders our PortfolioBacktester component.
*/

import PortfolioBacktester from '@/components/PortfolioBacktester';

export default function Home() {
  return (
    <main>
      <PortfolioBacktester />
    </main>
  );
}
