import { POSITION_OUTCOMES, type PositionOutcome } from "@crm/shared";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, type Contact, type Organization, type Position, unwrap } from "@/lib/api";
import { useChannels, useOrganizations, useProjectMutation, useStages } from "@/lib/queries";
import { humanize } from "@/lib/utils";

function DialogButtons({
  onCancel,
  pending,
  label = "Save",
}: {
  onCancel: () => void;
  pending: boolean;
  label?: string;
}) {
  return (
    <div className="flex justify-end gap-2 sm:col-span-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

export function OrganizationDialog({
  projectId,
  organization,
  defaultKind = "company",
  onClose,
  onCreated,
}: {
  projectId: string;
  organization?: Organization;
  defaultKind?: "company" | "agency";
  onClose: () => void;
  onCreated?: (o: Organization) => void;
}) {
  const [kind, setKind] = useState(organization?.kind ?? defaultKind);
  const [name, setName] = useState(organization?.name ?? "");
  const [website, setWebsite] = useState(organization?.website ?? "");
  const [notes, setNotes] = useState(organization?.notes ?? "");
  const save = useProjectMutation(
    projectId,
    () => {
      const body = { kind, name, website: website || null, notes: notes || null };
      return organization
        ? unwrap(
            api.PATCH("/api/projects/{projectId}/organizations/{organizationId}", {
              params: { path: { projectId, organizationId: organization.id } },
              body: { ...body, version: organization.version },
            }),
          )
        : unwrap(api.POST("/api/projects/{projectId}/organizations", { params: { path: { projectId } }, body }));
    },
    {
      success: organization ? "Saved" : "Organization created",
      onSuccess: (o) => {
        if (!organization) onCreated?.(o);
        onClose();
      },
    },
  );
  return (
    <Dialog open onOpenChange={onClose} title={organization ? "Edit organization" : "New organization"}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "company" | "agency")}>
            <option value="company">Company (employer)</option>
            <option value="agency">Agency (recruiter)</option>
          </Select>
        </Field>
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Website" className="sm:col-span-2">
          <Input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogButtons onCancel={onClose} pending={save.isPending} />
      </form>
    </Dialog>
  );
}

export function PositionDialog({
  projectId,
  position,
  defaults,
  onClose,
}: {
  projectId: string;
  position?: Position;
  defaults?: { companyId?: string; agencyId?: string };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const stages = useStages(projectId);
  const channels = useChannels(projectId);
  const companies = useOrganizations(projectId, { kind: "company" });
  const agencies = useOrganizations(projectId, { kind: "agency" });
  const [title, setTitle] = useState(position?.title ?? "");
  const [companyId, setCompanyId] = useState(position?.company?.id ?? defaults?.companyId ?? "");
  const [agencyId, setAgencyId] = useState(position?.agency?.id ?? defaults?.agencyId ?? "");
  const [url, setUrl] = useState(position?.url ?? "");
  const [description, setDescription] = useState(position?.descriptionMarkdown ?? "");
  const [stageId, setStageId] = useState(position?.stageId ?? "");
  const [outcome, setOutcome] = useState<PositionOutcome>(position?.outcome ?? "open");
  const [sourceChannelId, setSourceChannelId] = useState(position?.sourceChannelId ?? "");
  const [salaryMin, setSalaryMin] = useState(position?.salary.min?.toString() ?? "");
  const [salaryMax, setSalaryMax] = useState(position?.salary.max?.toString() ?? "");
  const [currency, setCurrency] = useState(position?.salary.currency ?? "EUR");
  const [period, setPeriod] = useState(position?.salary.period ?? "year");
  const [notes, setNotes] = useState(position?.notes ?? "");
  const [newOrg, setNewOrg] = useState<"company" | "agency" | null>(null);

  const save = useProjectMutation(
    projectId,
    () => {
      const hasSalary = salaryMin !== "" || salaryMax !== "";
      const body = {
        title,
        companyId: companyId || null,
        agencyId: agencyId || null,
        url: url || null,
        descriptionMarkdown: description || null,
        ...(stageId ? { stageId } : {}),
        outcome,
        sourceChannelId: sourceChannelId || null,
        salary: hasSalary
          ? {
              min: salaryMin === "" ? null : Number(salaryMin),
              max: salaryMax === "" ? null : Number(salaryMax),
              currency: currency || null,
              period: period as "year" | "month" | "hour",
            }
          : null,
        notes: notes || null,
      };
      return position
        ? unwrap(
            api.PATCH("/api/projects/{projectId}/positions/{positionId}", {
              params: { path: { projectId, positionId: position.id } },
              body: { ...body, version: position.version },
            }),
          )
        : unwrap(api.POST("/api/projects/{projectId}/positions", { params: { path: { projectId } }, body }));
    },
    {
      success: position ? "Position saved" : "Position created",
      onSuccess: (p) => {
        onClose();
        if (!position) navigate({ to: "/p/$projectId/positions/$positionId", params: { projectId, positionId: p.id } });
      },
    },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={position ? "Edit position" : "New position"}
      className="w-[min(760px,calc(100vw-2rem))]"
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Title" className="sm:col-span-2">
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior backend engineer"
          />
        </Field>
        <Field label="Company" hint="Leave empty while an agency keeps the client undisclosed">
          <div className="flex gap-2">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Unknown</option>
              {companies.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => setNewOrg("company")}>
              New
            </Button>
          </div>
        </Field>
        <Field label="Agency">
          <div className="flex gap-2">
            <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
              <option value="">None</option>
              {agencies.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => setNewOrg("agency")}>
              New
            </Button>
          </div>
        </Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {!position ? <option value="">First stage</option> : null}
            {stages.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as PositionOutcome)}>
            {POSITION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {humanize(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Listing URL">
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Found via">
          <Select value={sourceChannelId} onChange={(e) => setSourceChannelId(e.target.value)}>
            <option value="">—</option>
            {channels.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Salary range" className="sm:col-span-2">
          <div className="grid grid-cols-[1fr_1fr_5rem_8rem] gap-2">
            <Input
              type="number"
              min={0}
              placeholder="Min"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
            />
            <Input
              type="number"
              min={0}
              placeholder="Max"
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
            />
            <Input
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              aria-label="Currency"
            />
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value as "year" | "month" | "hour")}
              aria-label="Period"
            >
              <option value="year">per year</option>
              <option value="month">per month</option>
              <option value="hour">per hour</option>
            </Select>
          </div>
        </Field>
        <Field
          label="Listing text"
          hint="Paste the job description; listings disappear once filled"
          className="sm:col-span-2"
        >
          <Textarea className="min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogButtons onCancel={onClose} pending={save.isPending} />
      </form>
      {newOrg ? (
        <OrganizationDialog
          projectId={projectId}
          defaultKind={newOrg}
          onClose={() => setNewOrg(null)}
          onCreated={(o) => (o.kind === "company" ? setCompanyId(o.id) : setAgencyId(o.id))}
        />
      ) : null}
    </Dialog>
  );
}

export function ContactDialog({
  projectId,
  contact,
  defaultOrganizationId,
  onClose,
}: {
  projectId: string;
  contact?: Contact;
  defaultOrganizationId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const orgs = useOrganizations(projectId);
  const channels = useChannels(projectId);
  const [name, setName] = useState(contact?.name ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId ?? "");
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [handle, setHandle] = useState("");

  const save = useProjectMutation(
    projectId,
    () =>
      contact
        ? unwrap(
            api.PATCH("/api/projects/{projectId}/contacts/{contactId}", {
              params: { path: { projectId, contactId: contact.id } },
              body: { name, notes: notes || null, version: contact.version },
            }),
          )
        : unwrap(
            api.POST("/api/projects/{projectId}/contacts", {
              params: { path: { projectId } },
              body: {
                name,
                notes: notes || null,
                affiliations: organizationId ? [{ organizationId, title: title || null }] : [],
                handles: channelId && handle ? [{ channelId, value: handle }] : [],
              },
            }),
          ),
    {
      success: contact ? "Contact saved" : "Contact created",
      onSuccess: (c) => {
        onClose();
        if (!contact) navigate({ to: "/p/$projectId/contacts/$contactId", params: { projectId, contactId: c.id } });
      },
    },
  );

  return (
    <Dialog open onOpenChange={onClose} title={contact ? "Edit contact" : "New contact"}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Name" className="sm:col-span-2">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!contact ? (
          <>
            <Field label="Works at">
              <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                <option value="">—</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recruiter" />
            </Field>
            <Field label="Reach via">
              <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">—</option>
                {channels.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Address / handle">
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="name@company.com" />
            </Field>
          </>
        ) : null}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogButtons onCancel={onClose} pending={save.isPending} />
      </form>
    </Dialog>
  );
}
