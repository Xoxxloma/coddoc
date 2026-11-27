create table ledger.weather_import (
  id bigserial primary key,
  file_name varchar(255) not null,
  rows_loaded int not null default 0,
  status varchar(16) not null,
  error varchar(1000),
  loaded_by varchar(20) not null,
  loaded_at timestamp not null default now()
);

create table ledger.weather_reading (
  id bigserial primary key,
  import_id bigint not null references ledger.weather_import(id) on delete cascade,
  farm_id bigint not null,
  reading_date date not null,
  precipitation_mm numeric(6, 1),
  temperature_c numeric(4, 1),
  unique (farm_id, reading_date)
);
