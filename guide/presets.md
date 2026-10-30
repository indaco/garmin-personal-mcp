# Presets or freeform

Many setup guides for Claude and Garmin give all the work to the assistant. The assistant reads the
data, then writes the whole dashboard page: the code, the design and the data. This server gives you
two methods:

- **Presets** (`preset` or `blank`): the server writes the page from a tested template. The
  assistant writes only the coach notes.
- **Freeform** (`freeform`): the assistant designs the whole page. The server puts the data into
  the page, so the assistant does not copy it.

The presets are faster and use fewer tokens. We measured the two methods.

## What makes a page expensive

The cost of a model is mostly the tokens that it writes. A page that the model writes has three
parts:

- **The page code**: about 90 KB of HTML, CSS and JavaScript for the charts, tabs and themes.
- **The data**: the `getDashboardData` result is about 150 KB. The model must copy it into the page,
  character by character.
- **The thinking**: the model plans the page from a description of about 300 lines.

The model writes such a page in many parts. Each part sends the conversation again, so the input
tokens also grow.

The data causes two more problems:

- Claude Code saves a large tool result to a file. The Read tool shows only the first 37,000
  characters of a file that is one line long. Without Bash, Claude cannot read the rest. In our
  runs, the result was one line. Now each activity is on its own line, so Read can show the file in
  parts.
- Claude Desktop has no Bash. Also, one reply has an output limit: 128,000 tokens in our runs. A
  whole page probably does not fit in one reply.

## The measurements

We used Claude Code (`claude -p`) with Opus, on synthetic data: 75 activities in 12 weeks. The
costs are list prices. With a subscription, the runs count against your usage limits. Other clients
and models give other times and costs.

| Task                     | Claude writes the whole page                              | Preset                          |
| ------------------------ | --------------------------------------------------------- | ------------------------------- |
| First build              | 24 to 35 min, 191k to 280k output tokens, $6.6 to $9.2    | 34 s, 2.4k output tokens, $0.16 |
| Update                   | 75 s and $0.41 to $0.46 with Bash. It fails without Bash. | 13 s, $0.15, no Bash needed     |
| Data in the page         | the same as the tool output in all 5 runs                 | the same as the tool output     |
| Pages from the same data | 3 different layouts, 1 with a phone layout error          | one tested page                 |
| New widget               | Claude edits the page code (not measured)                 | 17 s, $0.15                     |
| New language (325 texts) | Claude edits the page code (not measured)                 | 64 s, $0.48                     |

In one run where Claude wrote the page, Claude also gave wrong totals in chat, because it did not
see all the data. With the template, Claude reads a digest of about 7 KB that has every number for
the notes. A check of each run found no invented number in the notes. The `getDashboardData` result
now also starts with this digest, so the totals come from the server and not from the assistant.

In these runs, Claude also copied the data into the page. With `freeform`, the server puts the data
in, so a build costs less. The page code still takes time and tokens.

## The limits of the presets

- **We maintain the page**: the template, the widgets and their tests are part of this project. A
  change to the page needs a new release.
- **One design**: each build gives the same page. You change it with the edit mode, custom widgets,
  languages and page settings, not with a new design.
- **No inline artifact**: in Claude Desktop, the dashboard is a file that you open in the browser.

For a different design, use `layout` = `freeform`.
