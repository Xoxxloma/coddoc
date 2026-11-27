create schema if not exists ledger;

create table ledger.crop (
  id bigserial primary key,
  code varchar(32) not null unique,
  name varchar(200) not null
);

create table ledger.measurement_template (
  id bigserial primary key,
  name varchar(200) not null,
  owner_number varchar(20) not null,
  created_at timestamp not null default now()
);

create table ledger.template_crop (
  template_id bigint not null references ledger.measurement_template(id) on delete cascade,
  crop_id bigint not null references ledger.crop(id) on delete cascade,
  primary key (template_id, crop_id)
);

create table ledger.template_assignment (
  id bigserial primary key,
  template_id bigint not null references ledger.measurement_template(id) on delete cascade,
  agronomist_number varchar(20) not null unique
);

create table ledger.measurement_entry (
  id bigserial primary key,
  agronomist_number varchar(20) not null,
  entry_date date not null,
  plot_id bigint,
  status varchar(16) not null default 'DRAFT',
  decided_by varchar(20),
  decision_comment varchar(1000),
  updated_at timestamp not null default now(),
  unique (agronomist_number, entry_date, plot_id)
);

create table ledger.entry_value (
  id bigserial primary key,
  entry_id bigint not null references ledger.measurement_entry(id) on delete cascade,
  crop_id bigint not null references ledger.crop(id) on delete cascade,
  value numeric(14, 3) not null
);

create table ledger.week_window (
  id bigserial primary key,
  agronomist_number varchar(20) not null,
  week_start date not null,
  reason varchar(1000),
  status varchar(16) not null default 'REQUESTED',
  opened_at timestamp,
  unique (agronomist_number, week_start)
);
