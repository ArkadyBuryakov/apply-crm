import { POSITION_OUTCOMES, type PositionOutcome } from "@crm/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import type { paths } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Empty, InlineField, InlineSelect, InlineText, useDraft, useInlineSave } from "@/components/ui/inline-field";
import { api, type Contact, type Organization, type Position, unwrap } from "@/lib/api";
import { useCan, useChannels, useOrganizations, useProjectMutation, useStages } from "@/lib/queries";
import { formatSalary, humanize } from "@/lib/utils";

type PatchBody<P extends keyof paths> = paths[P] extends {
  patch: { requestBody?: { content: { "application/json": infer B } } };
}
  ? Omit<B, "version">
  : never;

function DialogButtons({
  formId,
  onCancel,
  pending,
  label = "Save",
}: {
  formId: string;
  onCancel: () => void;
  pending: boolean;
  label?: string;
}) {
  return (
    <>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" form={formId} disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </>
  );
}

const ORG_KINDS = (
  <>
    <option value="company">Company (employer)</option>
    <option value="agency">Agency (recruiter)</option>
  </>
);

export function OrganizationDialog({
  projectId,
  organization,
  defaultKind = "company",
  onClose,
  onCreated,
}: {
  projectId: string;
  /** Show this organization, its fields editable one by one; otherwise create a new one. */
  organization?: Organization;
  defaultKind?: "company" | "agency";
  onClose: () => void;
  onCreated?: (o: Organization) => void;
}) {
  if (organization) return <OrganizationDetails projectId={projectId} organization={organization} onClose={onClose} />;
  return <OrganizationForm projectId={projectId} defaultKind={defaultKind} onClose={onClose} onCreated={onCreated} />;
}

function OrganizationForm({
  projectId,
  defaultKind,
  onClose,
  onCreated,
}: {
  projectId: string;
  defaultKind: "company" | "agency";
  onClose: () => void;
  onCreated?: (o: Organization) => void;
}) {
  const formId = useId();
  const [kind, setKind] = useState(defaultKind);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/organizations", {
          params: { path: { projectId } },
          body: { kind, name, website: website || null, notes: notes || null },
        }),
      ),
    {
      success: "Organization created",
      onSuccess: (o) => {
        onCreated?.(o);
        onClose();
      },
    },
  );
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New organization"
      footer={<DialogButtons formId={formId} onCancel={onClose} pending={save.isPending} />}
    >
      <form
        id={formId}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          // Opened from a position form, this dialog sits inside that form in the React tree.
          e.stopPropagation();
          save.mutate(undefined);
        }}
      >
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "company" | "agency")}>
            {ORG_KINDS}
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
      </form>
    </Dialog>
  );
}

function OrganizationDetails({
  projectId,
  organization,
  onClose,
}: {
  projectId: string;
  organization: Organization;
  onClose: () => void;
}) {
  const can = useCan(projectId);
  const canEdit = can("organization_entity:update");
  const {
    current: o,
    save,
    stateOf,
  } = useInlineSave(
    projectId,
    organization,
    (body: PatchBody<"/api/projects/{projectId}/organizations/{organizationId}">, version) =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/organizations/{organizationId}", {
          params: { path: { projectId, organizationId: organization.id } },
          body: { ...body, version },
        }),
      ),
  );
  return (
    <Dialog open onOpenChange={onClose} title={o.name}>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <InlineText
          label="Name"
          value={o.name}
          required
          canEdit={canEdit}
          state={stateOf("name")}
          onSave={(name) => save("name", { name }, { name })}
        />
        <InlineSelect
          label="Kind"
          value={o.kind}
          canEdit={canEdit}
          state={stateOf("kind")}
          onSave={(v) => {
            const kind = v as "company" | "agency";
            save("kind", { kind }, { kind });
          }}
        >
          {ORG_KINDS}
        </InlineSelect>
        <InlineText
          label="Website"
          type="url"
          value={o.website ?? ""}
          placeholder="https://"
          canEdit={canEdit}
          state={stateOf("website")}
          className="sm:col-span-2"
          onSave={(v) => save("website", { website: v || null }, { website: v || null })}
        />
        <InlineText
          label="Notes"
          multiline
          value={o.notes ?? ""}
          canEdit={canEdit}
          state={stateOf("notes")}
          className="sm:col-span-2"
          onSave={(v) => save("notes", { notes: v || null }, { notes: v || null })}
        />
      </div>
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
  /** Show this position, its fields editable one by one; otherwise create a new one. */
  position?: Position;
  defaults?: { companyId?: string; agencyId?: string };
  onClose: () => void;
}) {
  if (position) return <PositionDetails projectId={projectId} position={position} onClose={onClose} />;
  return <PositionForm projectId={projectId} defaults={defaults} onClose={onClose} />;
}

/** A company or agency picker with a button that creates a new one and picks it. */
function OrganizationPicker({
  projectId,
  kind,
  value,
  onChange,
  none,
}: {
  projectId: string;
  kind: "company" | "agency";
  value: string;
  onChange: (id: string) => void;
  none: string;
}) {
  const orgs = useOrganizations(projectId, { kind });
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex gap-2">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {orgs.data?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button variant="outline" onClick={() => setCreating(true)}>
        New
      </Button>
      {creating ? (
        <OrganizationDialog
          projectId={projectId}
          defaultKind={kind}
          onClose={() => setCreating(false)}
          onCreated={(o) => onChange(o.id)}
        />
      ) : null}
    </div>
  );
}

type SalaryDraft = { min: string; max: string; currency: string; period: "year" | "month" | "hour" };

function salaryBody(s: SalaryDraft) {
  if (s.min === "" && s.max === "") return null;
  return {
    min: s.min === "" ? null : Number(s.min),
    max: s.max === "" ? null : Number(s.max),
    currency: s.currency || null,
    period: s.period,
  };
}

function SalaryInputs({ value, onChange }: { value: SalaryDraft; onChange: (v: SalaryDraft) => void }) {
  const set = (patch: Partial<SalaryDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-[1fr_1fr_5rem_8rem] gap-2">
      <Input type="number" min={0} placeholder="Min" value={value.min} onChange={(e) => set({ min: e.target.value })} />
      <Input type="number" min={0} placeholder="Max" value={value.max} onChange={(e) => set({ max: e.target.value })} />
      <Input
        maxLength={3}
        value={value.currency}
        onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
        aria-label="Currency"
      />
      <Select
        value={value.period}
        onChange={(e) => set({ period: e.target.value as SalaryDraft["period"] })}
        aria-label="Period"
      >
        <option value="year">per year</option>
        <option value="month">per month</option>
        <option value="hour">per hour</option>
      </Select>
    </div>
  );
}

function PositionForm({
  projectId,
  defaults,
  onClose,
}: {
  projectId: string;
  defaults?: { companyId?: string; agencyId?: string };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const formId = useId();
  const stages = useStages(projectId);
  const channels = useChannels(projectId);
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? "");
  const [agencyId, setAgencyId] = useState(defaults?.agencyId ?? "");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [stageId, setStageId] = useState("");
  const [outcome, setOutcome] = useState<PositionOutcome>("open");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [salary, setSalary] = useState<SalaryDraft>({ min: "", max: "", currency: "EUR", period: "year" });
  const [notes, setNotes] = useState("");

  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/positions", {
          params: { path: { projectId } },
          body: {
            title,
            companyId: companyId || null,
            agencyId: agencyId || null,
            url: url || null,
            descriptionMarkdown: description || null,
            ...(stageId ? { stageId } : {}),
            outcome,
            sourceChannelId: sourceChannelId || null,
            salary: salaryBody(salary),
            notes: notes || null,
          },
        }),
      ),
    {
      success: "Position created",
      onSuccess: (p) => {
        onClose();
        navigate({ to: "/p/$projectId/positions/$positionId", params: { projectId, positionId: p.id } });
      },
    },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New position"
      className="w-[min(760px,calc(100vw-2rem))]"
      footer={<DialogButtons formId={formId} onCancel={onClose} pending={save.isPending} />}
    >
      <form
        id={formId}
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
          <OrganizationPicker
            projectId={projectId}
            kind="company"
            value={companyId}
            onChange={setCompanyId}
            none="Unknown"
          />
        </Field>
        <Field label="Agency">
          <OrganizationPicker projectId={projectId} kind="agency" value={agencyId} onChange={setAgencyId} none="None" />
        </Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">First stage</option>
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
          <SalaryInputs value={salary} onChange={setSalary} />
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
      </form>
    </Dialog>
  );
}

function PositionDetails({
  projectId,
  position,
  onClose,
}: {
  projectId: string;
  position: Position;
  onClose: () => void;
}) {
  const can = useCan(projectId);
  const canEdit = can("position:update");
  const stages = useStages(projectId);
  const channels = useChannels(projectId);
  const {
    current: p,
    save,
    stateOf,
  } = useInlineSave(
    projectId,
    position,
    (body: PatchBody<"/api/projects/{projectId}/positions/{positionId}">, version) =>
      unwrap(
        api.PATCH("/api/projects/{projectId}/positions/{positionId}", {
          params: { path: { projectId, positionId: position.id } },
          body: { ...body, version },
        }),
      ),
  );
  const savedSalary: SalaryDraft = {
    min: p.salary.min?.toString() ?? "",
    max: p.salary.max?.toString() ?? "",
    currency: p.salary.currency ?? "EUR",
    period: p.salary.period ?? "year",
  };
  const salaryDraft = useDraft(savedSalary, (s) => save("salary", { salary: salaryBody(s) }));
  const salary = formatSalary(p.salary);
  const orgLink = (org: { id: string; name: string } | null, none: ReactNode) =>
    org ? (
      <Link
        to="/p/$projectId/organizations/$organizationId"
        params={{ projectId, organizationId: org.id }}
        className="text-primary hover:underline"
        onClick={onClose}
      >
        {org.name}
      </Link>
    ) : (
      none
    );

  return (
    <Dialog open onOpenChange={onClose} title={p.title} className="w-[min(760px,calc(100vw-2rem))]">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <InlineText
          label="Title"
          value={p.title}
          required
          canEdit={canEdit}
          state={stateOf("title")}
          className="sm:col-span-2"
          onSave={(title) => save("title", { title }, { title })}
        />
        <InlineField
          label="Company"
          canEdit={canEdit}
          state={stateOf("companyId")}
          view={orgLink(p.company, <span className="text-muted-foreground">Undisclosed</span>)}
          editor={
            <OrganizationPicker
              projectId={projectId}
              kind="company"
              value={p.company?.id ?? ""}
              onChange={(id) => save("companyId", { companyId: id || null })}
              none="Unknown"
            />
          }
        />
        <InlineField
          label="Agency"
          canEdit={canEdit}
          state={stateOf("agencyId")}
          view={orgLink(p.agency, <Empty />)}
          editor={
            <OrganizationPicker
              projectId={projectId}
              kind="agency"
              value={p.agency?.id ?? ""}
              onChange={(id) => save("agencyId", { agencyId: id || null })}
              none="None"
            />
          }
        />
        <InlineSelect
          label="Stage"
          value={p.stageId}
          canEdit={canEdit}
          state={stateOf("stageId")}
          onSave={(stageId) => save("stageId", { stageId }, { stageId })}
        >
          {stages.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </InlineSelect>
        <InlineSelect
          label="Outcome"
          value={p.outcome}
          canEdit={canEdit}
          state={stateOf("outcome")}
          onSave={(v) => {
            const outcome = v as PositionOutcome;
            save("outcome", { outcome }, { outcome });
          }}
        >
          {POSITION_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </InlineSelect>
        <InlineText
          label="Listing URL"
          type="url"
          value={p.url ?? ""}
          placeholder="https://"
          canEdit={canEdit}
          state={stateOf("url")}
          onSave={(v) => save("url", { url: v || null }, { url: v || null })}
        />
        <InlineSelect
          label="Found via"
          value={p.sourceChannelId ?? ""}
          canEdit={canEdit}
          state={stateOf("sourceChannelId")}
          onSave={(v) => save("sourceChannelId", { sourceChannelId: v || null }, { sourceChannelId: v || null })}
        >
          <option value="">—</option>
          {channels.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </InlineSelect>
        <InlineField
          label="Salary range"
          canEdit={canEdit}
          state={stateOf("salary")}
          className="sm:col-span-2"
          onEdit={salaryDraft.start}
          onDone={salaryDraft.flush}
          view={
            salary ? (
              <>
                {salary.range}
                {salary.yearly ? <span className="ml-1 text-muted-foreground">({salary.yearly})</span> : null}
              </>
            ) : (
              <Empty />
            )
          }
          onBlur={salaryDraft.flush}
          editor={<SalaryInputs value={salaryDraft.draft} onChange={salaryDraft.change} />}
        />
        <InlineText
          label="Listing text"
          multiline
          value={p.descriptionMarkdown ?? ""}
          canEdit={canEdit}
          state={stateOf("descriptionMarkdown")}
          className="sm:col-span-2"
          onSave={(v) =>
            save("descriptionMarkdown", { descriptionMarkdown: v || null }, { descriptionMarkdown: v || null })
          }
        />
        <InlineText
          label="Notes"
          multiline
          value={p.notes ?? ""}
          canEdit={canEdit}
          state={stateOf("notes")}
          className="sm:col-span-2"
          onSave={(v) => save("notes", { notes: v || null }, { notes: v || null })}
        />
      </div>
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
  /** Show this contact, its fields editable one by one; otherwise create a new one. */
  contact?: Contact;
  defaultOrganizationId?: string;
  onClose: () => void;
}) {
  if (contact) return <ContactDetails projectId={projectId} contact={contact} onClose={onClose} />;
  return <ContactForm projectId={projectId} defaultOrganizationId={defaultOrganizationId} onClose={onClose} />;
}

function ContactForm({
  projectId,
  defaultOrganizationId,
  onClose,
}: {
  projectId: string;
  defaultOrganizationId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const formId = useId();
  const orgs = useOrganizations(projectId);
  const channels = useChannels(projectId);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId ?? "");
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [handle, setHandle] = useState("");

  const save = useProjectMutation(
    projectId,
    () =>
      unwrap(
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
      success: "Contact created",
      onSuccess: (c) => {
        onClose();
        navigate({ to: "/p/$projectId/contacts/$contactId", params: { projectId, contactId: c.id } });
      },
    },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New contact"
      footer={<DialogButtons formId={formId} onCancel={onClose} pending={save.isPending} />}
    >
      <form
        id={formId}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Name" className="sm:col-span-2">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
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
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function ContactDetails({ projectId, contact, onClose }: { projectId: string; contact: Contact; onClose: () => void }) {
  const can = useCan(projectId);
  const canEdit = can("contact:update");
  const {
    current: c,
    save,
    stateOf,
  } = useInlineSave(projectId, contact, (body: PatchBody<"/api/projects/{projectId}/contacts/{contactId}">, version) =>
    unwrap(
      api.PATCH("/api/projects/{projectId}/contacts/{contactId}", {
        params: { path: { projectId, contactId: contact.id } },
        body: { ...body, version },
      }),
    ),
  );
  return (
    <Dialog open onOpenChange={onClose} title={c.name}>
      <div className="grid gap-3">
        <InlineText
          label="Name"
          value={c.name}
          required
          canEdit={canEdit}
          state={stateOf("name")}
          onSave={(name) => save("name", { name }, { name })}
        />
        <InlineText
          label="Notes"
          multiline
          value={c.notes ?? ""}
          canEdit={canEdit}
          state={stateOf("notes")}
          onSave={(v) => save("notes", { notes: v || null }, { notes: v || null })}
        />
      </div>
    </Dialog>
  );
}
