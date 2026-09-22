import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Input, Select } from '../ui/Field.tsx'

export type ProfileDraft = { nickname: string; team: string }

export function ProfileSetupCard({
  draft,
  teams,
  onChange,
  onSave,
}: {
  draft: ProfileDraft
  teams: readonly string[]
  onChange: (next: ProfileDraft) => void
  onSave: () => void
}) {
  return (
    <Card className="townhall-setup">
      <div className="stack-list">
        <div>
          <span className="eyebrow">Step 1</span>
          <h2>Choose your anonymous nickname and team</h2>
          <p className="muted">Nicknames and teams are visible in the townhall feed, but they are not linked to your real identity.</p>
        </div>
      </div>
      <div className="townhall-setup__grid">
        <Field label="Anonymous nickname">
          <Input
            value={draft.nickname}
            onChange={(event) => onChange({ ...draft, nickname: event.target.value })}
            maxLength={24}
            placeholder="BrightSpark42"
          />
        </Field>
        <Field label="Team">
          <Select
            value={draft.team}
            onChange={(event) => onChange({ ...draft, team: event.target.value })}
          >
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="button" onClick={onSave}>
        Join the AI Townhall
      </Button>
    </Card>
  )
}
