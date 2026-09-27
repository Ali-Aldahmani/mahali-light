import { redirect } from 'next/navigation';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';

export default function MobileIndex() {
  redirect(MOBILE_HOME);
}
