-- Migration 003: Reporting and Anomaly Views (PRD §7, §10)
-- Every view exposes center_id so callers can scope rows without joining.

-- View 1: view_device_stale_rate_anomalies (PRD §7 lines 793-808)
create or replace view view_device_stale_rate_anomalies
with (security_invoker = true) as
select
  so.center_id,
  so.device_id,
  so.actor_id,
  count(*) as stale_ops_last_hour,
  max(so.created_at) as latest_stale_op_at
from sync_ops so
join entries e on e.id = so.entry_id and e.center_id = so.center_id
where so.op_type = 'create_entry'
  and e.stale_rates = true
  and e.stale_review_status in ('none', 'flagged')
  and so.created_at > now() - interval '1 hour'
group by so.center_id, so.device_id, so.actor_id
having count(*) >= 5;

-- View 2: v_monthly_totals (PRD §10 lines 1772-1789, Finding 1)
create or replace view v_monthly_totals
with (security_invoker = true) as
select
  center_id,
  date_trunc('month', entry_date)::date as month,
  count(*) as entries,
  sum(sub_qty) as total_sub_qty,
  sum(gross_poisha) as gross,
  sum(vat_poisha) as vat,
  sum(commission_poisha) as commission,
  sum(charge_poisha) as total_charge,
  sum(business_charge_poisha) as business_charge,
  sum(customer_charge_poisha) as customer_charge,
  sum(net_poisha) as net
from entries
where status = 'active'
group by center_id, date_trunc('month', entry_date)::date;

-- View 3: v_monthly_method_charges (PRD §10 lines 1790-1803, Finding 1)
create or replace view v_monthly_method_charges
with (security_invoker = true) as
select
  e.center_id,
  date_trunc('month', e.entry_date)::date as month,
  m.code,
  sum(e.business_charge_poisha) as business_charge,
  sum(e.customer_charge_poisha) as customer_charge,
  sum(e.charge_poisha) as total_charge,
  count(*) as entries
from entries e
join payment_methods m on m.id = e.method_id and m.center_id = e.center_id
where e.status = 'active'
group by e.center_id, date_trunc('month', e.entry_date)::date, m.code;

-- View 4: v_staff_personal_metrics (PRD §10 lines 1804-1834, Finding 1)
create or replace view v_staff_personal_metrics
with (security_invoker = true) as
select
  center_id,
  created_by,
  count(*) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date) as entries_today,
  coalesce(sum(gross_poisha) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date), 0) as gross_today,
  count(*) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)) as entries_this_month,
  coalesce(sum(gross_poisha) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)), 0) as gross_this_month
from entries
where status = 'active' and created_by = auth.uid()
group by center_id, created_by;
