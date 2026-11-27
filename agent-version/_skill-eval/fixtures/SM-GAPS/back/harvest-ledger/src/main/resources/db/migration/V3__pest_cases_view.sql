-- Закрытые случаи вредителей для сводки.
create materialized view ledger.mv_pest_cases as
select c.id,
       c.farm_id,
       c.region_id,
       c.closed_at
from pestwatch.pest_case c
where c.status = 'CLOSED';

create unique index mv_pest_cases_id on ledger.mv_pest_cases (id);
