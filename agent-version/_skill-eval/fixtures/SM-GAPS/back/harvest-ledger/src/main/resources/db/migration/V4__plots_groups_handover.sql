create table ledger.crop_group (
  id bigserial primary key,
  name varchar(200) not null unique,
  sort_order int not null default 100
);

alter table ledger.crop add column group_id bigint references ledger.crop_group(id);

create table ledger.plot (
  id bigserial primary key,
  owner_number varchar(20) not null,
  farm_id bigint not null,
  name varchar(200) not null,
  area_ha numeric(10, 2),
  archived boolean not null default false
);

alter table ledger.measurement_entry
  add constraint measurement_entry_plot_fk foreign key (plot_id) references ledger.plot(id);

create table ledger.handover_request (
  id bigserial primary key,
  from_head varchar(20) not null,
  to_head varchar(20) not null,
  status varchar(16) not null default 'REQUESTED',
  decided_by varchar(20),
  created_at timestamp not null default now()
);
