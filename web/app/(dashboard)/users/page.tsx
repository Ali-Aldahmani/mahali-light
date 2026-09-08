import { redirect } from 'next/navigation';

export default function UsersRedirect() {
  redirect('/team?tab=users');
}
