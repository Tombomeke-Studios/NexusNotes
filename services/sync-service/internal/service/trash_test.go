package service

import (
	"reflect"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func TestNoteTitles_Distinct(t *testing.T) {
	got := noteTitles([]model.TrashedNote{{Title: "A"}, {Title: "B"}, {Title: "A"}})
	if !reflect.DeepEqual(got, []string{"A", "B"}) {
		t.Fatalf("got %v", got)
	}
}
