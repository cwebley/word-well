CREATE TABLE product_signals (
  id bigserial PRIMARY KEY,
  event text NOT NULL CHECK (event IN ('install_cta_shown', 'install_cta_started', 'install_confirmed')),
  capability text NOT NULL CHECK (capability IN ('chromium_prompt', 'ios_home_screen')),
  day date NOT NULL,
  received_at timestamptz NOT NULL
);
