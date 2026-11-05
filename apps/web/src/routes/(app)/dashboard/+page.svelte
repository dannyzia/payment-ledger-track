<script lang="ts">
  import { session } from '$lib/auth/session.svelte';
  import StaffDashboard from '$lib/ui/dashboards/StaffDashboard.svelte';
  import AdminDashboard from '$lib/ui/dashboards/AdminDashboard.svelte';
  import OwnerDashboard from '$lib/ui/dashboards/OwnerDashboard.svelte';

  const userDisplayName = $derived(
    session.user?.fullName ?? 'Counter Staff'
  );
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
  {:else if session.user.role === 'owner'}
    <OwnerDashboard ownerName={userDisplayName} />
  {:else if session.user.role === 'admin'}
    <AdminDashboard />
  {:else}
    <StaffDashboard userId={session.user.id} userName={userDisplayName} />
  {/if}
</div>
