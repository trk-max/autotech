-- 0001 core schema (AutoTech TRD v1.0 §2.2)
-- ===== EXTENSIONS & ENUMS =====
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TYPE content_origin AS ENUM ('oem_verbatim','oem_derived','editorial','community','test_fixture');
CREATE TYPE fuel_type AS ENUM ('petrol','diesel','lpg','cng','hybrid_petrol','hybrid_diesel','electric','hydrogen');
CREATE TYPE hv_system AS ENUM ('none','mhev','hev','phev','bev','fcev');
CREATE TYPE node_kind AS ENUM ('pin','splice','ground','inline_connector','fuse','relay_terminal');
CREATE TYPE signal_kind AS ENUM ('power','ground','signal','can_h','can_l','lin','flexray','ethernet','shield','hv_pos','hv_neg');
CREATE TYPE measure_kind AS ENUM ('voltage_dc','voltage_ac','resistance','current','frequency','duty_cycle','continuity','waveform','visual');

-- ===== 0. PROVENANCE / LICENSING =====
CREATE TABLE data_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  origin content_origin NOT NULL,
  licence_ref text,
  licence_expires_at date,
  redistribution_allowed boolean NOT NULL DEFAULT false,
  territory text[] DEFAULT '{EU}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== 1. VEHICLE MATRIX =====
CREATE TABLE make (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  wmi_codes char(3)[] NOT NULL DEFAULT '{}'
);
CREATE TABLE model (
  id serial PRIMARY KEY,
  make_id int NOT NULL REFERENCES make(id),
  name text NOT NULL,
  UNIQUE (make_id, name)
);
CREATE TABLE model_generation (
  id serial PRIMARY KEY,
  model_id int NOT NULL REFERENCES model(id),
  name text NOT NULL,                 -- 'Golf VII'
  platform_code text,                 -- 'MQB / 5G'
  year_from smallint NOT NULL,
  year_to smallint,
  body_types text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE engine (
  id serial PRIMARY KEY,
  make_id int NOT NULL REFERENCES make(id),
  code text NOT NULL,                 -- 'CJZA', 'K9K 636'
  fuel fuel_type NOT NULL,
  displacement_cc int,
  cylinders smallint,
  aspiration text CHECK (aspiration IN ('na','turbo','twin_turbo','supercharged')),
  timing_drive text CHECK (timing_drive IN ('belt','chain','gear','none')),
  max_power_kw numeric(6,1),
  UNIQUE (make_id, code)
);
CREATE TABLE transmission (
  id serial PRIMARY KEY,
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('manual','automatic','dct','cvt','single_speed')),
  gears smallint
);
CREATE TABLE vehicle_variant (
  id serial PRIMARY KEY,
  generation_id int NOT NULL REFERENCES model_generation(id),
  engine_id int REFERENCES engine(id),
  transmission_id int REFERENCES transmission(id),
  power_kw numeric(6,1) NOT NULL,
  drive text CHECK (drive IN ('fwd','rwd','awd')),
  hv hv_system NOT NULL DEFAULT 'none',
  hv_voltage_nominal int,
  year_from smallint NOT NULL,
  year_to smallint,
  markets text[] NOT NULL DEFAULT '{EU}',
  ext_ktype int UNIQUE                -- only if TecDoc is licensed
);
CREATE INDEX ON vehicle_variant (generation_id, year_from);

CREATE TABLE vin_pattern (
  id serial PRIMARY KEY,
  wmi char(3) NOT NULL,
  vds_regex text NOT NULL,            -- applied to VIN positions 4-9
  model_year_from smallint,
  model_year_to smallint,
  generation_id int REFERENCES model_generation(id),
  variant_ids int[] NOT NULL DEFAULT '{}',
  priority smallint NOT NULL DEFAULT 0
);
CREATE INDEX ON vin_pattern (wmi);

CREATE TABLE vin_decode_cache (
  vin char(17) PRIMARY KEY,
  variant_id int REFERENCES vehicle_variant(id),
  candidates int[] NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  raw jsonb,
  decoded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plate_lookup_cache (
  country char(2) NOT NULL,
  plate text NOT NULL,
  vin char(17),
  provider text NOT NULL,
  looked_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, plate)
);

-- ===== 2. APPLICABILITY =====
CREATE TABLE applicability_group (
  id bigserial PRIMARY KEY,
  signature text NOT NULL UNIQUE,     -- hash(sorted variant ids + conditions)
  conditions jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE applicability_member (
  group_id bigint NOT NULL REFERENCES applicability_group(id) ON DELETE CASCADE,
  variant_id int NOT NULL REFERENCES vehicle_variant(id),
  PRIMARY KEY (group_id, variant_id)
);
CREATE INDEX ON applicability_member (variant_id);

-- ===== 3. COMPONENTS & NETWORK TOPOLOGY =====
CREATE TABLE component_type (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,          -- 'CKP_SENSOR', 'ECM'
  name text NOT NULL,
  system ltree NOT NULL
);
CREATE TABLE component (
  id bigserial PRIMARY KEY,
  type_id int NOT NULL REFERENCES component_type(id),
  oem_ref text,                       -- 'G28', 'J623'
  name text NOT NULL,
  is_ecu boolean NOT NULL DEFAULT false,
  location_text text,
  location_asset_key text,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE INDEX ON component USING gin (oem_ref gin_trgm_ops);

CREATE TABLE network_bus (
  id serial PRIMARY KEY,
  name text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('can_hs','can_fd','can_ls','lin','flexray','most','ethernet','kline')),
  bitrate_kbps int,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id)
);
CREATE TABLE bus_node (
  bus_id int NOT NULL REFERENCES network_bus(id),
  component_id bigint NOT NULL REFERENCES component(id),
  is_gateway boolean NOT NULL DEFAULT false,
  diag_address text,
  PRIMARY KEY (bus_id, component_id)
);

-- ===== 4. WIRING GRAPH =====
CREATE TABLE connector (
  id bigserial PRIMARY KEY,
  component_id bigint REFERENCES component(id),
  code text NOT NULL,                 -- 'T60'
  cavity_count smallint,
  housing_colour text,
  end_view_asset_key text,
  location_text text
);
CREATE TABLE electrical_node (
  id bigserial PRIMARY KEY,
  kind node_kind NOT NULL,
  connector_id bigint REFERENCES connector(id),
  pin_label text,
  name text,
  location_text text,
  CHECK (kind <> 'pin' OR (connector_id IS NOT NULL AND pin_label IS NOT NULL))
);
CREATE TABLE wire (
  id bigserial PRIMARY KEY,
  from_node_id bigint NOT NULL REFERENCES electrical_node(id),
  to_node_id bigint NOT NULL REFERENCES electrical_node(id),
  colour_primary varchar(3) NOT NULL, -- DIN 72551 codes
  colour_stripe varchar(3),
  cross_section_mm2 numeric(4,2),
  signal signal_kind NOT NULL,
  circuit_label text,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE INDEX ON wire (from_node_id);
CREATE INDEX ON wire (to_node_id);

CREATE TABLE wiring_diagram (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  system ltree NOT NULL,
  render_mode text NOT NULL CHECK (render_mode IN ('interactive_svg','verbatim_raster','verbatim_pdf')),
  asset_key text NOT NULL,
  asset_sha256 char(64) NOT NULL,
  version int NOT NULL DEFAULT 1,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE diagram_element (        -- SVG id → graph entity bridge
  diagram_id bigint NOT NULL REFERENCES wiring_diagram(id) ON DELETE CASCADE,
  svg_element_id text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('wire','node','connector','component','ground')),
  entity_id bigint NOT NULL,
  PRIMARY KEY (diagram_id, svg_element_id)
);
CREATE INDEX ON diagram_element (entity_kind, entity_id);

CREATE TABLE pin_spec (
  id bigserial PRIMARY KEY,
  node_id bigint NOT NULL REFERENCES electrical_node(id),
  ref_node_id bigint REFERENCES electrical_node(id),  -- NULL = chassis ground
  condition text NOT NULL,            -- 'ignition_on', 'engine_idle'
  measure measure_kind NOT NULL,
  expected_min numeric(10,3),
  expected_max numeric(10,3),
  unit text,
  waveform_asset_key text
);

-- ===== 5. DTC & DIAGNOSTICS =====
CREATE TABLE dtc_definition (
  id bigserial PRIMARY KEY,
  code varchar(8) NOT NULL,
  make_id int REFERENCES make(id),    -- NULL = generic SAE J2012
  description text NOT NULL,
  system ltree,
  UNIQUE NULLS NOT DISTINCT (code, make_id)
);
CREATE INDEX ON dtc_definition USING gin (code gin_trgm_ops);

CREATE TABLE dtc_vehicle_link (       -- which ECU sets the code on this vehicle, and which ECU it says is silent
  id bigserial PRIMARY KEY,
  dtc_id bigint NOT NULL REFERENCES dtc_definition(id),
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  setting_component_id bigint REFERENCES component(id),
  lost_comm_component_id bigint REFERENCES component(id),
  set_conditions text,
  UNIQUE (dtc_id, applicability_group_id)
);

CREATE TABLE test_procedure (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  component_id bigint REFERENCES component(id),
  est_minutes smallint NOT NULL,
  intrusiveness smallint NOT NULL CHECK (intrusiveness BETWEEN 1 AND 5),
  requires_hv_isolation boolean NOT NULL DEFAULT false,
  tools text[] NOT NULL DEFAULT '{}',
  target_kind text NOT NULL DEFAULT 'component' CHECK (target_kind IN ('component','bus','node','ecu_supply')),
  bus_id int REFERENCES network_bus(id),
  node_id bigint REFERENCES electrical_node(id),
  procedure_ref bigint, -- optional link to repair procedure (FK added later)
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE dtc_cause (
  id bigserial PRIMARY KEY,
  dtc_id bigint NOT NULL REFERENCES dtc_definition(id),
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  cause_kind text NOT NULL CHECK (cause_kind IN ('component','open_circuit','short_to_ground',
    'short_to_battery','connector','network','power_supply','software','mechanical')),
  component_id bigint REFERENCES component(id),
  wire_id bigint REFERENCES wire(id),
  bus_id int REFERENCES network_bus(id),
  prior_weight numeric(4,3) NOT NULL CHECK (prior_weight BETWEEN 0 AND 1),
  test_procedure_id bigint REFERENCES test_procedure(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE test_step (
  id bigserial PRIMARY KEY,
  procedure_id bigint NOT NULL REFERENCES test_procedure(id) ON DELETE CASCADE,
  seq smallint NOT NULL,
  instruction_md text NOT NULL,
  pin_spec_id bigint REFERENCES pin_spec(id),
  on_pass_step_id bigint REFERENCES test_step(id),
  on_fail_step_id bigint REFERENCES test_step(id),
  conclusion text,
  conclusion_cause_id bigint REFERENCES dtc_cause(id)
);

-- ===== 6. PROCEDURES, TORQUE, TOOLS =====
CREATE TABLE procedure (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('removal','installation','r_and_r','adjustment','body_sectioning',
    'body_dimensions','hv_deactivation','adas_calibration','service_reset','maintenance_task')),
  title text NOT NULL,
  system ltree NOT NULL,
  render_mode text NOT NULL CHECK (render_mode IN ('verbatim_pdf','verbatim_html','structured')),
  asset_key text,
  body jsonb,
  language char(2) NOT NULL DEFAULT 'en',
  version int NOT NULL DEFAULT 1,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED,
  CHECK (render_mode = 'structured' OR asset_key IS NOT NULL)
);
CREATE INDEX ON procedure USING gin (search_tsv);

CREATE TABLE torque_spec (
  id bigserial PRIMARY KEY,
  procedure_id bigint REFERENCES procedure(id),
  component_id bigint REFERENCES component(id),
  fastener text NOT NULL,
  stages jsonb NOT NULL,              -- [{"nm":40},{"deg":90},{"deg":90}]
  replace_fastener boolean NOT NULL DEFAULT false,
  hotspot jsonb,                      -- {"asset":"…","x":0.42,"y":0.61}
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE special_tool (
  id serial PRIMARY KEY,
  make_id int REFERENCES make(id),
  oem_tool_no text NOT NULL,
  name text NOT NULL,
  generic_alt text
);
CREATE TABLE procedure_tool (
  procedure_id bigint NOT NULL REFERENCES procedure(id),
  tool_id int NOT NULL REFERENCES special_tool(id),
  PRIMARY KEY (procedure_id, tool_id)
);

-- ===== 7. LABOR (DAG) =====
CREATE TABLE labor_step (
  id bigserial PRIMARY KEY,
  code text NOT NULL,                 -- 'RR_FRONT_BUMPER'
  name text NOT NULL,
  hours numeric(5,2) NOT NULL,        -- removal + refit
  is_access boolean NOT NULL,         -- shareable teardown vs core work
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  UNIQUE (code, applicability_group_id)
);
CREATE TABLE labor_step_dependency (
  step_id bigint NOT NULL REFERENCES labor_step(id),
  requires_step_id bigint NOT NULL REFERENCES labor_step(id),
  PRIMARY KEY (step_id, requires_step_id),
  CHECK (step_id <> requires_step_id)
);
CREATE TABLE labor_operation (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  system ltree NOT NULL,
  oem_hours numeric(5,2) NOT NULL,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE labor_operation_step (
  operation_id bigint NOT NULL REFERENCES labor_operation(id),
  step_id bigint NOT NULL REFERENCES labor_step(id),
  PRIMARY KEY (operation_id, step_id)
);
CREATE TABLE labor_overlap_rule (     -- explicit OEM overlap overrides the DAG
  op_a_id bigint NOT NULL REFERENCES labor_operation(id),
  op_b_id bigint NOT NULL REFERENCES labor_operation(id),
  deduct_hours numeric(5,2) NOT NULL,
  PRIMARY KEY (op_a_id, op_b_id),
  CHECK (op_a_id < op_b_id)
);

-- ===== 8. MAINTENANCE & FLUIDS =====
CREATE TABLE maintenance_schedule (
  id bigserial PRIMARY KEY,
  regime text NOT NULL CHECK (regime IN ('normal','severe','flexible_longlife')),
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);
CREATE TABLE maintenance_item (
  id bigserial PRIMARY KEY,
  schedule_id bigint NOT NULL REFERENCES maintenance_schedule(id) ON DELETE CASCADE,
  task text NOT NULL,
  operation_id bigint REFERENCES labor_operation(id),
  interval_km int,
  interval_months smallint,
  first_at_km int,
  first_at_months smallint,
  whichever_first boolean NOT NULL DEFAULT true,
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);
CREATE TABLE fluid_spec (
  id bigserial PRIMARY KEY,
  system text NOT NULL,
  capacity numeric(6,2),
  unit text NOT NULL DEFAULT 'l',
  specification text,
  viscosity text,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id)
);

-- ===== 9. TSB / RECALL / FIELD CASES =====
CREATE TABLE tsb (
  id bigserial PRIMARY KEY,
  make_id int NOT NULL REFERENCES make(id),
  oem_number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tsb','recall','campaign')),
  title text NOT NULL,
  symptom_md text,
  remedy_md text,
  asset_key text,
  published_at date,
  superseded_by bigint REFERENCES tsb(id),
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  source_id uuid NOT NULL REFERENCES data_source(id),
  UNIQUE (make_id, oem_number)
);
CREATE TABLE tsb_dtc (
  tsb_id bigint NOT NULL REFERENCES tsb(id),
  dtc_id bigint NOT NULL REFERENCES dtc_definition(id),
  PRIMARY KEY (tsb_id, dtc_id)
);
CREATE TABLE field_case (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,
  author_id uuid NOT NULL,
  symptom text NOT NULL,
  root_cause text NOT NULL,
  fix_md text NOT NULL,
  mileage_km int,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','verified','rejected')),
  verified_by uuid,
  applicability_group_id bigint NOT NULL REFERENCES applicability_group(id),
  component_id bigint REFERENCES component(id),
  node_id bigint REFERENCES electrical_node(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON field_case USING gin (symptom gin_trgm_ops);
CREATE TABLE field_case_dtc (
  case_id bigint NOT NULL REFERENCES field_case(id) ON DELETE CASCADE,
  dtc_id bigint NOT NULL REFERENCES dtc_definition(id),
  PRIMARY KEY (case_id, dtc_id)
);
CREATE TABLE field_case_feedback (
  case_id bigint NOT NULL REFERENCES field_case(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('fixed','not_fixed')),
  PRIMARY KEY (case_id, user_id)
);

-- ===== 10. TENANCY & SESSIONS =====
CREATE TABLE organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'service'   -- service | diagnostics | full
);
CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organization(id),
  role text NOT NULL CHECK (role IN ('technician','advisor','admin','editor','reviewer')),
  sermi_cert_id text
);
CREATE TABLE diag_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  variant_id int NOT NULL REFERENCES vehicle_variant(id),
  vin char(17),
  dtc_ids bigint[] NOT NULL CHECK (cardinality(dtc_ids) BETWEEN 1 AND 10),
  state jsonb NOT NULL DEFAULT '{}',
  outcome_cause_id bigint REFERENCES dtc_cause(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  variant_id int NOT NULL REFERENCES vehicle_variant(id),
  operation_ids bigint[] NOT NULL,
  gross_hours numeric(6,2) NOT NULL,
  net_hours numeric(6,2) NOT NULL,
  breakdown jsonb NOT NULL,
  hourly_rate_millimes int NOT NULL,
  total_millimes bigint NOT NULL,
  customer_name text,
  currency char(3) NOT NULL DEFAULT 'TND',
  pdf_asset_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_access_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  entity_kind text NOT NULL,
  entity_id bigint NOT NULL,
  source_id uuid NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE test_procedure ADD FOREIGN KEY (procedure_ref) REFERENCES procedure(id);

-- Field fix suggested to the wizard is shown with its maintenance/labor link
CREATE INDEX ON diag_session (org_id, created_at DESC);
CREATE INDEX ON quote (org_id, created_at DESC);
