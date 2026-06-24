import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const TOPICS = [
  { id: "topic-ai", label: "AI & Machine Learning" },
  { id: "topic-web", label: "Web Platform" },
  { id: "topic-devtools", label: "Developer Tooling" },
  { id: "topic-security", label: "Security" },
]

export default function App() {
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(
    null,
  )
  const [track, setTrack] = useState("")
  const [level, setLevel] = useState("")
  const [length, setLength] = useState("")
  const [topics, setTopics] = useState<string[]>([])
  const [newsletter, setNewsletter] = useState(false)
  const [agree, setAgree] = useState(false)

  function toggleTopic(label: string, checked: boolean) {
    setTopics((prev) =>
      checked ? [...prev, label] : prev.filter((t) => t !== label),
    )
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSubmitted({
      fullName: fd.get("fullName"),
      email: fd.get("email"),
      company: fd.get("company"),
      track,
      level,
      sessionLength: length,
      abstract: fd.get("abstract"),
      topics,
      newsletter,
      agree,
    })
  }

  return (
    <div className="min-h-svh bg-muted/40 py-12 px-4">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              Conference Speaker Application
            </CardTitle>
            <CardDescription>
              MonkeyConf 2026 — tell us about the talk you'd like to give.
            </CardDescription>
          </CardHeader>
          <form id="speaker-form" onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
              {/* Text fields */}
              <div className="grid gap-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  placeholder="Ada Lovelace"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="ada@example.com"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="company">Company / Affiliation</Label>
                  <Input
                    id="company"
                    name="company"
                    placeholder="Analytical Engines Ltd."
                  />
                </div>
              </div>

              {/* Dropdowns */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="track">Track</Label>
                  <Select value={track} onValueChange={setTrack}>
                    <SelectTrigger id="track" className="w-full">
                      <SelectValue placeholder="Select a track" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frontend">Frontend</SelectItem>
                      <SelectItem value="backend">Backend</SelectItem>
                      <SelectItem value="ai-ml">AI / ML</SelectItem>
                      <SelectItem value="platform">Platform & Infra</SelectItem>
                      <SelectItem value="design">Design & UX</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="level">Experience level</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger id="level" className="w-full">
                      <SelectValue placeholder="Select a level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Textarea */}
              <div className="grid gap-2">
                <Label htmlFor="abstract">Talk abstract</Label>
                <Textarea
                  id="abstract"
                  name="abstract"
                  rows={5}
                  placeholder="What is your talk about? What will attendees learn?"
                />
              </div>

              {/* Radio group */}
              <div className="grid gap-3">
                <Label>Preferred session length</Label>
                <RadioGroup value={length} onValueChange={setLength}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="lightning" id="len-lightning" />
                    <Label htmlFor="len-lightning" className="font-normal">
                      Lightning (10 min)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="standard" id="len-standard" />
                    <Label htmlFor="len-standard" className="font-normal">
                      Standard (30 min)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="deep-dive" id="len-deep" />
                    <Label htmlFor="len-deep" className="font-normal">
                      Deep dive (60 min)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Checkboxes */}
              <div className="grid gap-3">
                <Label>Topics of interest</Label>
                {TOPICS.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <Checkbox
                      id={t.id}
                      onCheckedChange={(c) => toggleTopic(t.label, c === true)}
                    />
                    <Label htmlFor={t.id} className="font-normal">
                      {t.label}
                    </Label>
                  </div>
                ))}
              </div>

              {/* Switch */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="newsletter">Subscribe to the newsletter</Label>
                  <p className="text-sm text-muted-foreground">
                    Occasional updates about MonkeyConf and the CFP.
                  </p>
                </div>
                <Switch
                  id="newsletter"
                  checked={newsletter}
                  onCheckedChange={setNewsletter}
                />
              </div>

              {/* Consent checkbox */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="agree"
                  checked={agree}
                  onCheckedChange={(c) => setAgree(c === true)}
                />
                <Label htmlFor="agree" className="font-normal leading-snug">
                  I agree to the code of conduct and to being contacted about
                  this submission.
                </Label>
              </div>
            </CardContent>
            <CardFooter className="mt-6 flex justify-end gap-3">
              <Button type="reset" variant="outline">
                Reset
              </Button>
              <Button type="submit" disabled={!agree}>
                Submit application
              </Button>
            </CardFooter>
          </form>
        </Card>

        {submitted && (
          <Card id="submission-result" className="border-green-500/50">
            <CardHeader>
              <CardTitle className="text-lg text-green-600">
                ✓ Application submitted
              </CardTitle>
              <CardDescription>
                Here is what we received:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm">
                {JSON.stringify(submitted, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
