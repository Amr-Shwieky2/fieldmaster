import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { EntryCostEstimate } from "@fieldmaster/api-client";
import { useErrorMessage, useFormat } from "../../i18n/hooks";
import { useAuth } from "../../lib/auth-context";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { isolateLtr } from "../LtrText";
import { ErrorView } from "../StateViews";
import { ReviewCard } from "./ReviewCard";

type CostState = { status: "loading" } | { status: "loaded"; cost: EntryCostEstimate } | { status: "failed"; cause: unknown };

/**
 * Money: the entry's estimated cost in ₪, from its own endpoint
 * (`GET /time-entries/:id/estimated-cost`; the evidence never carries money).
 * The screen mounts this card only for a member holding VIEW_FINANCIALS and
 * VIEW_COMPENSATION, so nobody else's phone ever asks for it. `reloadKey`
 * asks again (after an action changed the entry, or a refresh).
 */
export function EntryCostCard({ timeEntryId, reloadKey }: { timeEntryId: string; reloadKey: number }) {
  const tCost = useTranslations("review.cost");
  const tStates = useTranslations("states");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const [state, setState] = useState<CostState>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    client.getTimeEntryEstimatedCost(timeEntryId).then(
      (cost) => {
        if (active) setState({ status: "loaded", cost });
      },
      (cause: unknown) => {
        if (active) setState({ status: "failed", cause });
      },
    );
    return () => {
      active = false;
    };
  }, [client, timeEntryId, reloadKey, retry]);

  const money = (agorot: number) => isolateLtr(format.money(agorot));
  return (
    <ReviewCard title={tCost("title")} testID="entry-cost">
      {state.status === "loading" ? (
        <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={tStates("loading")}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {state.status === "failed" ? <ErrorView message={`${tCost("loadError")}\n${errorMessage(state.cause)}`} onRetry={() => setRetry((count) => count + 1)} /> : null}
      {state.status === "loaded" ? (
        <>
          {state.cost.estimatedCostAgorot !== null ? (
            <>
              {state.cost.baseAgorot !== null ? <AppText>{tCost("base", { amount: money(state.cost.baseAgorot) })}</AppText> : null}
              {state.cost.overtimeAgorot !== null ? <AppText>{tCost("overtime", { amount: money(state.cost.overtimeAgorot) })}</AppText> : null}
              <AppText weight="bold" size="large">
                {tCost("total", { amount: money(state.cost.estimatedCostAgorot) })}
              </AppText>
            </>
          ) : null}
          {tCost.has(`basis.${state.cost.basis}`) ? (
            <AppText size="small" color={colors.muted}>
              {tCost(`basis.${state.cost.basis}`)}
            </AppText>
          ) : null}
        </>
      ) : null}
    </ReviewCard>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.md, alignItems: "center" },
});
