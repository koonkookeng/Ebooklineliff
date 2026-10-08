// SSOT Phase 059 §5.1 — UpdatePreference command (thin use-case facade)
// Canonical: apps/backend/src/modules/reader/application/commands/update-preference.command.ts
// - Zod-gates the wire input then delegates to ReaderPreferenceService.
// - tsx-safe, zero new deps.
import { UserReaderPreferenceSchema } from '@repo/shared';
import { ReaderPreferenceService, type NavPreferenceInput } from '../reader-preference.service';

export async function updateReaderPreferenceCommand(
  service: Pick<ReaderPreferenceService, 'updatePreference'>,
  userId: string,
  input: NavPreferenceInput,
): Promise<boolean> {
  const gated = UserReaderPreferenceSchema.pick({
    invertTapZones: true,
    swipeSensitivity: true,
    enableKeyboardShortcuts: true,
    hapticFeedbackEnabled: true,
  })
    .partial()
    .safeParse({
      invertTapZones: input.invertTapZones ?? input.invertTap,
      swipeSensitivity: input.swipeSensitivity,
      enableKeyboardShortcuts: input.enableKeyboardShortcuts ?? input.enableKeybindings,
      hapticFeedbackEnabled: input.hapticFeedbackEnabled,
    });
  if (!gated.success) throw new Error('Invalid reader preference input');
  return service.updatePreference(userId, {
    invertTapZones: gated.data.invertTapZones,
    swipeSensitivity: gated.data.swipeSensitivity,
    enableKeyboardShortcuts: gated.data.enableKeyboardShortcuts,
    hapticFeedbackEnabled: gated.data.hapticFeedbackEnabled,
    customKeybindingsJson: input.customKeybindingsJson,
  });
}
