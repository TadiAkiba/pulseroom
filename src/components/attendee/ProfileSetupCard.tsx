import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Input } from '../ui/Field.tsx'

export type ProfileDraft = { nickname: string }

export function ProfileSetupCard({
  draft,
  onChange,
  onSave,
}: {
  draft: ProfileDraft
  onChange: (next: ProfileDraft) => void
  onSave: () => void
}) {
  return (
    <Card className="townhall-setup">
      <div className="stack-list">
        <div>
          <span className="eyebrow">Step 1</span>
          <h2>Choose your anonymous nickname</h2>
          <p className="muted">Nicknames are visible in the townhall feed, but they are not linked to your real identity.</p>
        </div>
      </div>
      <div className="townhall-setup__grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <Field label="Anonymous nickname">
          <Input
            value={draft.nickname}
            onChange={(event) => onChange({ ...draft, nickname: event.target.value })}
            maxLength={24}
            placeholder="BrightSpark42"
          />
        </Field>
      </div>
      <Button type="button" onClick={onSave}>
        Join the AI Townhall
      </Button>
    </Card>
  )
}
