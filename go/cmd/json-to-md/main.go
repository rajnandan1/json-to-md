// json-to-md converts one JSON document into deterministic, human-readable
// GitHub Flavored Markdown. Unix filter contract: FILE arg or stdin in,
// Markdown on stdout, exit codes 0 (success) / 1 (conversion failed) /
// 2 (usage or I/O), with --json for structured errors on stderr.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	jsontomd "github.com/rajnandan1/json-to-md/go/v3"
	"github.com/spf13/cobra"
)

// version is injected at release time: -ldflags "-X main.version=...".
var version = "dev"

// jsonLocation mirrors the TypeScript error field names so tooling parses
// identical JSON from either implementation.
type jsonLocation struct {
	Offset int `json:"offset"`
	Line   int `json:"line"`
	Column int `json:"column"`
}

type jsonError struct {
	Code          string        `json:"code"`
	Pointer       string        `json:"pointer,omitempty"`
	Location      *jsonLocation `json:"location,omitempty"`
	FirstLocation *jsonLocation `json:"firstLocation,omitempty"`
	Message       string        `json:"message"`
}

func toJSONLocation(l *jsontomd.SourceLocation) *jsonLocation {
	if l == nil {
		return nil
	}
	return &jsonLocation{Offset: l.Offset, Line: l.Line, Column: l.Column}
}

func printConversionError(w io.Writer, e *jsontomd.Error, asJSON bool) {
	if asJSON {
		out, _ := json.Marshal(jsonError{
			Code:          string(e.Code),
			Pointer:       e.Pointer,
			Location:      toJSONLocation(e.Location),
			FirstLocation: toJSONLocation(e.FirstLocation),
			Message:       e.Message,
		})
		fmt.Fprintln(w, string(out))
		return
	}
	at := ""
	if e.Location != nil {
		at = fmt.Sprintf(" at %d:%d", e.Location.Line, e.Location.Column)
	}
	if e.FirstLocation != nil {
		at += fmt.Sprintf(" (first at %d:%d)", e.FirstLocation.Line, e.FirstLocation.Column)
	}
	fmt.Fprintf(w, "json-to-md: %s%s: %s\n", e.Code, at, e.Message)
}

func run(cmd *cobra.Command, args []string, showTypes bool) error {
	var input []byte
	var err error
	if len(args) == 1 && args[0] != "-" {
		input, err = os.ReadFile(args[0])
	} else {
		input, err = io.ReadAll(cmd.InOrStdin())
	}
	if err != nil {
		return err
	}
	var opts []jsontomd.Option
	if showTypes {
		opts = append(opts, jsontomd.WithTypes())
	}
	out, err := jsontomd.ConvertText(input, opts...)
	if err != nil {
		return err
	}
	fmt.Fprint(cmd.OutOrStdout(), out)
	return nil
}

func main() {
	var jsonErrors bool
	var showTypes bool

	root := &cobra.Command{
		Use:   "json-to-md [FILE]",
		Short: "Convert one JSON document into deterministic, human-readable GitHub Flavored Markdown",
		Long: `Convert one JSON document into deterministic, human-readable
GitHub Flavored Markdown.

With no FILE, or when FILE is '-', reads standard input.
Markdown goes to stdout; errors go to stderr.

Exit codes:
  0  success
  1  conversion failed
  2  usage or I/O error`,
		Example: `  json-to-md data.json > out.md
  curl -s https://api.example.com/items | json-to-md
  json-to-md --json broken.json 2> error.json`,
		Args:    cobra.MaximumNArgs(1),
		Version: version,
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, args, showTypes)
		},
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.Flags().BoolVar(&jsonErrors, "json", false,
		"emit conversion errors as JSON on stderr (fields: code, pointer, location, firstLocation, message)")
	root.Flags().BoolVar(&showTypes, "types", false,
		"annotate values with their JSON types (42 *(integer)*)")

	err := root.Execute()
	if err == nil {
		return
	}
	var convErr *jsontomd.Error
	if errors.As(err, &convErr) {
		printConversionError(os.Stderr, convErr, jsonErrors)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "json-to-md: %v\nRun 'json-to-md --help' for usage.\n", err)
	os.Exit(2)
}
