-- Carrier directory for internal contracting only; catalog presence never grants insurer authorization.
CREATE TABLE IF NOT EXISTS carrier_directory (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  country text NOT NULL CHECK (country IN ('CA','US')),
  connection_mode text NOT NULL DEFAULT 'manual' CHECK (connection_mode IN ('manual','authorized_api','authorized_file')),
  connection_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (connection_mode <> 'manual' OR connection_verified = false)
);
INSERT INTO carrier_directory (id,display_name,country) VALUES
 ('ia-financial-group','iA Financial Group (Industrial Alliance)','CA'),
 ('manulife','Manulife','CA'),
 ('sun-life','Sun Life','CA'),
 ('canada-life','Canada Life','CA')
ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE carrier_directory IS 'Public reference names, not a representation of carrier affiliation, appointment, or API access.';
