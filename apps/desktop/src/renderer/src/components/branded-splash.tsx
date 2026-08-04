import { t } from '@arava/shared';
import { SplashScreen } from '@arava/ui';

import { BrandMark } from './brand-mark';

export function BrandedSplash() {
  return <SplashScreen label={t('splash.loading')} logo={<BrandMark />} />;
}
