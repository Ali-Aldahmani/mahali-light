import { redirect } from 'next/navigation';

export default function EmployeesRedirect() {
  redirect('/team?tab=employees');
}
