/**
 * Stepper — the load-bearing +/- control of packing-list.
 *
 * Used twice in the Trip Detail screen:
 *   - duration stepper (prominent, 56pt buttons)
 *   - per-item quantity stepper (44pt buttons — design system min target)
 *
 * Design system constraints:
 *   - No bouncy press animation. Use opacity dim on press (Pressable's pressed state).
 *   - Single 150ms ease-out curve elsewhere; this control is static + haptic.
 *   - Approval green is reserved for verified/done — never used here.
 *   - Mono digits for the number so the column doesn't shift width as you tap.
 *
 * Behavior:
 *   - Tap +/- to step by 1, with `expo-haptics.selectionAsync()`.
 *   - Clamps at min/max.
 *   - If `onRemove` is provided, pressing − while at min calls onRemove
 *     (the item-row pattern from the spec: "Holding − past 0 removes the item").
 *   - Long-press − also calls onRemove if provided, regardless of value.
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { t } from '../i18n';
import { useTheme, typography, radius, target } from '../theme';
import type { Colors } from '../theme';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** If provided, − while at min (or long-pressing −) calls this. */
  onRemove?: () => void;
  /** Bigger control for hero use (duration). Defaults to false (item-row size). */
  prominent?: boolean;
  /** Accessibility label, e.g. "Quantity of Underwear". */
  label?: string;
};

export function Stepper({
  value,
  onChange,
  min = 1,
  max = Number.POSITIVE_INFINITY,
  onRemove,
  prominent = false,
  label,
}: Props) {
  const { c } = useTheme();
  const s = makeStyles(c, prominent);

  const tap = useCallback(() => {
    // selectionAsync is the right haptic for "stepped change" interactions.
    // Failures (no haptic engine, e.g. simulator) are intentionally swallowed.
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const handleMinus = useCallback(() => {
    tap();
    if (value <= min) {
      if (onRemove) onRemove();
      return;
    }
    onChange(value - 1);
  }, [value, min, onRemove, onChange, tap]);

  const handlePlus = useCallback(() => {
    tap();
    if (value >= max) return;
    onChange(value + 1);
  }, [value, max, onChange, tap]);

  const handleLongPressMinus = useCallback(() => {
    if (onRemove) {
      // Slightly stronger haptic to signal "something just happened".
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      onRemove();
    }
  }, [onRemove]);

  const minusDisabled = value <= min && !onRemove;
  const plusDisabled = value >= max;

  return (
    <View style={s.container} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: String(value) }}>
      <Pressable
        onPress={handleMinus}
        onLongPress={handleLongPressMinus}
        disabled={minusDisabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={onRemove && value <= min ? t('common.remove') : t('stepper.decrease')}
        style={({ pressed }) => [
          s.btn,
          s.btnLeft,
          minusDisabled && s.btnDisabled,
          pressed && !minusDisabled && s.btnPressed,
        ]}
      >
        <Minus size={prominent ? 22 : 18} color={minusDisabled ? c.fgSubtle : c.fg} strokeWidth={1.5} />
      </Pressable>

      <View style={s.numberWrap}>
        <Text style={s.number} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {value}
        </Text>
      </View>

      <Pressable
        onPress={handlePlus}
        disabled={plusDisabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t('stepper.increase')}
        style={({ pressed }) => [
          s.btn,
          s.btnRight,
          plusDisabled && s.btnDisabled,
          pressed && !plusDisabled && s.btnPressed,
        ]}
      >
        <Plus size={prominent ? 22 : 18} color={plusDisabled ? c.fgSubtle : c.fg} strokeWidth={1.5} />
      </Pressable>
    </View>
  );
}

function makeStyles(c: Colors, prominent: boolean) {
  const btnSize = prominent ? 56 : target.min; // 44pt min (design system floor)
  const numberW = prominent ? 64 : 44;
  const numberFontSize = prominent ? 24 : 18;
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    btn: {
      width: btnSize,
      height: btnSize,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bgElevated,
    },
    btnLeft: {
      borderRightWidth: 1,
      borderRightColor: c.hairline,
    },
    btnRight: {
      borderLeftWidth: 1,
      borderLeftColor: c.hairline,
    },
    btnPressed: {
      backgroundColor: c.bgSubtle,
      opacity: 0.85,
    },
    btnDisabled: {
      backgroundColor: c.bgSubtle,
    },
    numberWrap: {
      width: numberW,
      height: btnSize,
      alignItems: 'center',
      justifyContent: 'center',
    },
    number: {
      fontFamily: typography.monoEmphasis,
      fontSize: numberFontSize,
      lineHeight: numberFontSize + 4,
      color: c.fg,
      fontVariant: ['tabular-nums'],
    },
  });
}
