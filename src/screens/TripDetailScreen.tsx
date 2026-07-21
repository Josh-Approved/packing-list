/**
 * TripDetailScreen — single scrolling screen with all editing inline.
 *
 * Reads the trip from useTripsStore via route.params.tripId; dispatches every
 * change back through updateTrip(id, fn). State changes show up immediately
 * because Zustand selector re-renders the screen when the matched trip object
 * changes.
 *
 * Sections, top to bottom (per spec § Trip Detail):
 *   - In-screen header: back button + page chrome
 *   - Trip name (inline-editable) + packed progress
 *   - Duration stepper
 *   - Trip-type chip grid (multi-select; recomposes items)
 *   - Packers row (horizontal scroll + add)
 *   - Items grouped by category
 *
 * The assignee pill on each item row is HIDDEN when packers.length === 1 —
 * the field still exists internally and defaults to the sole packer; pills
 * appear automatically when a 2nd packer is added.
 *
 * Sticky bottom: an always-visible "Add an item" input. Tapping the category
 * pill cycles through CATEGORY_ORDER. Submitting either taps + or hits return.
 * If the typed name already exists (case-insensitive), its quantity is bumped
 * by 1 instead of duplicating the row.
 *
 * Decomposed under ./tripDetail/ (soft size ceilings): styles, flat-row model,
 * ItemRow, AddItemBar, UndoBar, DoneFab, and the useTripDetailHandlers /
 * useUndoableRemove hooks. Behavior is unchanged — this file is composition
 * + render.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, ChevronLeft, ChevronRight, Share2 } from 'lucide-react-native';
import { NestedReorderableList, ScrollViewContainer } from 'react-native-reorderable-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  TRIP_TYPES,
  SHARED_ASSIGNEE,
  groupByCategory,
  tripOpts,
  visibleItems,
} from '../data/trip';
import { useTripsStore } from '../store/trips';
import { t as tr, pickLocale, getLocale, CANONICAL_LOCALES } from '../i18n';
import { useLocalePreference } from '../i18n/localePreference';
import { useTheme, space, target } from '../theme';
import { Pill } from '../components/Pill';
import { SyncStatusBar } from '../components/SyncStatusBar';
import { useActionMenu, usePrompt } from '../components/Dialogs';
import type { RootStackParamList } from '../../App';
import { makeStyles } from './tripDetail/styles';
import { buildFlatRows } from './tripDetail/flatRows';
import { ItemRow } from './tripDetail/ItemRow';
import { UndoBar } from './tripDetail/UndoBar';
import { DoneFab } from './tripDetail/DoneFab';
import { AddItemBar } from './tripDetail/AddItemBar';
import { useTripDetailHandlers } from './tripDetail/useTripDetailHandlers';
import { useUndoableRemove } from './tripDetail/useUndoableRemove';

type Props = NativeStackScreenProps<RootStackParamList, 'TripDetail'>;

export default function TripDetailScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const menu = useActionMenu();
  const prompt = usePrompt();

  // Active in-app locale, so typed-in item names categorize in the user's
  // chosen language (not just English). 'system' resolves the device locale to
  // a supported tag; an explicit pick is used as-is. Falls back to 'en'.
  const { pref } = useLocalePreference();
  const activeLocale =
    pref === 'system'
      ? pickLocale(getLocale(), [...CANONICAL_LOCALES]) ?? 'en'
      : pref;

  const { tripId } = route.params;
  const trip = useTripsStore((st) => st.trips.find((t) => t.id === tripId));

  const {
    editingItemId,
    editingName,
    setEditingName,
    scrollRef,
    contentRef,
    scrollEditingIntoView,
    handleBack,
    handleOpenTripInfo,
    handleQuantityChange,
    handlePackedToggle,
    handleAssigneeCycle,
    handlePackerLongPress,
    handleReorder,
    handleAddPacker,
    handleStartEditItem,
    handleFinishEditItem,
  } = useTripDetailHandlers(tripId, navigation, menu, prompt);

  const { recentlyRemoved, handleItemRemove, handleUndoRemove } =
    useUndoableRemove(tripId);

  // ---------- Derived ----------

  const groupedItems = useMemo(
    () => (trip ? groupByCategory(trip.items) : []),
    [trip]
  );

  const flatRows = useMemo(() => buildFlatRows(groupedItems), [groupedItems]);

  if (!trip) {
    // Trip vanished (unlikely in MVP — no delete from this screen yet).
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerBar}>
          <Pressable onPress={handleBack} hitSlop={12} style={s.backBtn} accessibilityLabel={tr('common.back')}>
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>
        <View style={s.missingWrap}>
          <Text style={s.missingText}>{tr('detail.missing')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const itemsHeading = trip.typeIds.length === 0 ? tr('detail.yourList') : tr('detail.suggestedItems');
  // Tombstoned items (deletedAt != null) exist only so a delete survives a
  // cross-device merge — never count or render them.
  const visible = visibleItems(trip);
  const packedCount = visible.filter((i) => i.packed).length;
  const totalCount = visible.length;
  const isSoloPacker = trip.packers.length === 1;

  // One-line summary for the condensed header: duration · types · how
  // thorough · laundry (only when on). Legacy trips read sensible defaults
  // via tripOpts so the line is always complete.
  const o = tripOpts(trip);
  const typeNames = trip.typeIds
    .map((id) => TRIP_TYPES.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n);
  const typeSummary =
    typeNames.length === 0
      ? tr('detail.noTripTypes')
      : typeNames.length <= 2
        ? typeNames.join(', ')
        : `${typeNames.slice(0, 2).join(', ')} +${typeNames.length - 2}`;
  const metaParts = [
    `${trip.duration} ${trip.duration === 1 ? tr('common.day') : tr('common.days')}`,
    typeSummary,
    o.thoroughness.charAt(0).toUpperCase() + o.thoroughness.slice(1),
  ];
  if (o.canDoLaundry) {
    metaParts.push(
      tr('detail.laundryEvery', {
        count: o.laundryIntervalDays,
        unit: o.laundryIntervalDays === 1 ? tr('common.day') : tr('common.days'),
      })
    );
  }
  const tripMeta = metaParts.join('  ·  ');

  const assigneeLabel = (id: string): string => {
    if (id === SHARED_ASSIGNEE) return tr('detail.shared');
    return trip.packers.find((p) => p.id === id)?.name ?? tr('detail.shared');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={s.kbWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* In-screen header (back button + share) */}
        <View style={s.headerBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={tr('detail.backToTrips')}
          >
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Share', { tripId })}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={tr('share.shareA11y')}
          >
            <Share2 size={22} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>

        {/* Honest live-sync indicator + tap-to-resync — shared trips only. */}
        {trip.shareIdentity && (
          <SyncStatusBar secret={trip.shareIdentity.secret} />
        )}

        <ScrollViewContainer
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View ref={contentRef} collapsable={false}>
          {/* Condensed trip info — stays out of the way; tap to reopen the
              Trip Information step and edit name / duration / types /
              thoroughness / laundry. */}
          <Pressable
            onPress={handleOpenTripInfo}
            style={({ pressed }) => [s.tripInfoCard, pressed && s.tripInfoCardPressed]}
            accessibilityRole="button"
            accessibilityLabel={tr('detail.tripInfoA11y', { name: trip.name, meta: tripMeta })}
          >
            <View style={s.tripInfoTop}>
              <Text style={s.tripInfoName} numberOfLines={1}>
                {trip.name}
              </Text>
              <ChevronRight size={20} color={c.fgMuted} strokeWidth={1.5} />
            </View>
            <Text style={s.tripInfoMeta} numberOfLines={2}>
              {tripMeta}
            </Text>
          </Pressable>

          <Text style={s.progressText}>
            {totalCount === 0
              ? tr('detail.noItemsYet')
              : tr('detail.packedProgress', { packed: packedCount, total: totalCount })}
          </Text>

          {/* Packers */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{tr('detail.packers')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.packersRow}
            >
              {trip.packers.map((p) => (
                <Pill
                  key={p.id}
                  label={p.name}
                  onLongPress={() => handlePackerLongPress(p)}
                  accessibilityLabel={tr('detail.packerA11y', { name: p.name })}
                />
              ))}
              <Pressable
                onPress={handleAddPacker}
                style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel={tr('detail.addPacker')}
              >
                <Plus size={18} color={c.fg} strokeWidth={1.5} />
              </Pressable>
            </ScrollView>
          </View>

          {/* Items */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{itemsHeading}</Text>
            {flatRows.length === 0 ? (
              <Text style={s.empty}>
                {tr('detail.itemsEmpty')}
              </Text>
            ) : (
              <NestedReorderableList
                data={flatRows}
                keyExtractor={(row) =>
                  row.kind === 'header' ? `h-${row.category}` : row.item.id
                }
                scrollable={false}
                onReorder={handleReorder}
                renderItem={({ item: row }) =>
                  row.kind === 'header' ? (
                    <Text style={s.categoryHeading}>{row.category}</Text>
                  ) : (
                    <ItemRow
                      item={row.item}
                      isSoloPacker={isSoloPacker}
                      isEditing={editingItemId === row.item.id}
                      editingName={editingName}
                      assigneeLabel={assigneeLabel(row.item.assigneeId)}
                      onPackedToggle={() => handlePackedToggle(row.item.id)}
                      onQuantityChange={(n) => handleQuantityChange(row.item.id, n)}
                      onItemRemove={() => handleItemRemove(row.item.id)}
                      onAssigneeCycle={() => handleAssigneeCycle(row.item.id)}
                      onStartEdit={() => handleStartEditItem(row.item)}
                      onChangeEditingName={setEditingName}
                      onFinishEdit={handleFinishEditItem}
                      onEditFocus={scrollEditingIntoView}
                      c={c}
                      s={s}
                    />
                  )
                }
              />
            )}
          </View>

          {/* Bottom spacer — must clear BOTH the sticky add-item bar AND the
              floating Done FAB above it, otherwise the last item's +/- stepper
              is occluded by the FAB at rest (its "+" becomes untappable until
              scrolled). The FAB sits at bottom: target.min + space.s6 +
              insets.bottom and is 56pt tall; clear its top edge + a margin. */}
          <View style={{ height: target.min + space.s6 + 56 + space.s5 + insets.bottom }} />
          </View>
        </ScrollViewContainer>

        {/* ---------- Undo snackbar (above the sticky add-item bar) ---------- */}
        {recentlyRemoved && (
          <UndoBar
            itemName={recentlyRemoved.item.name}
            onUndo={handleUndoRemove}
            s={s}
          />
        )}

        {/* ---------- Sticky bottom: Add an item ---------- */}
        <AddItemBar tripId={tripId} menu={menu} activeLocale={activeLocale} c={c} s={s} />
      </KeyboardAvoidingView>

      {/* Done FAB — hidden while the Undo snackbar is up (see DoneFab doc). */}
      {!recentlyRemoved && <DoneFab onPress={handleBack} c={c} s={s} />}

      {menu.element}
      {prompt.element}
    </SafeAreaView>
  );
}
