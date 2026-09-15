import type { PlanScope, Raid, Squad } from "@/types/nexus";

/**
 * Qui commande quoi, tel que l'API en juge.
 *
 * Désactiver un bouton est une politesse, pas une règle : chacun de ces actes
 * est refusé côté serveur aussi. Ce qu'on gagne à le calculer ici est de ne pas
 * offrir ce qui sera refusé — pas de garantie, et le code d'ici ne doit jamais
 * servir de garde-fou.
 *
 * Miroir de `governsPlan` dans `nexus-tools/lib/plans.ts`, qui reste l'autorité.
 */

/** Le chef de l'escouade, ou l'un de ses lieutenants. */
export function commandsSquad(squad: Squad, userId: string): boolean {
  return (
    squad.leaderId === userId ||
    squad.members.some(
      (member) => member.userId === userId && member.lieutenant,
    )
  );
}

/** Mener un raid, c'est commander son escouade meneuse. */
export function leadsRaid(raid: Raid | null, userId: string): boolean {
  if (!raid) return false;

  const lead = raid.squads.find((squad) => squad.id === raid.leadSquadId);
  return lead ? commandsSquad(lead, userId) : false;
}

/**
 * Qui tient un plan : le plan d'une escouade répond à qui la commande, celui
 * d'un raid à qui le mène.
 */
export function governsPlan(
  scope: PlanScope,
  ranks: { commands: boolean; leads: boolean },
): boolean {
  return scope === "raid" ? ranks.leads : ranks.commands;
}
