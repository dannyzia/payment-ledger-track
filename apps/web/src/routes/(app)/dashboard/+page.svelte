<script lang="ts">
  import { session } from '$lib/auth/session.svelte';
  import { hasCenterCapability } from '$lib/capabilities';
  import type { UserRole } from '@clt/shared';
  import StaffDashboard from '$lib/ui/dashboards/StaffDashboard.svelte';
  import AdminDashboard from '$lib/ui/dashboards/AdminDashboard.svelte';
  import OwnerDashboard from '$lib/ui/dashboards/OwnerDashboard.svelte';

  const userDisplayName = $derived(session.user?.fullName ?? 'Counter Staff');

  // Which dashboard, decided by capability rather than the role string: Owner holds
  // `month.close`, Admin holds `report.read`, staff neither. The platform seat has no
  // center scope, so it keeps the staff view (it has its own platform surfaces).
  const role = $derived((session.user?.role ?? 'staff') as UserRole);
  const isOwnerView = $derived(hasCenterCapability(role, 'month.close'));
  const isAdminView = $derived(hasCenterCapability(role, 'report.read'));
</script>

<div class="role-dashboard p-6 max-w-5xl mx-auto w-full">
  {#if session.loading || !session.user}
    <!-- Skeleton loader prevents flash of Staff UI while session resolves -->
    <div class="flex flex-col gap-6 animate-pulse">
      <div class="h-8 bg-slate-200 rounded w-1/3"></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="h-28 bg-slate-200 rounded-2xl"></div>
        <div class="h-28 bg-slate-200 rounded-2xl"></div>
      </div>
      <div class="h-64 bg-slate-200 rounded-2xl"></div>
    </div>
  {:else if isOwnerView}
    <OwnerDashboard ownerName={userDisplayName} />
  {:else if isAdminView}
    <AdminDashboard />
  {:else}
    <StaffDashboard userId={session.user.id} userName={userDisplayName} />
  {/if}
</div>
