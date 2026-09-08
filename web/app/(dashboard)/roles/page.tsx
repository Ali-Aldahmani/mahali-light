import { redirect } from 'next/navigation';

export default function RolesRedirect() {
  redirect('/team?tab=roles');
}
