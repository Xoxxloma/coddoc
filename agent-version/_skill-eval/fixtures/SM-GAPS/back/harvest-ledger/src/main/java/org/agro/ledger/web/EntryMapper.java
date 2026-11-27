package org.agro.ledger.web;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import org.agro.ledger.api.model.EntryDay;
import org.agro.ledger.api.model.EntryValue;
import org.agro.ledger.domain.EntryStatus;
import org.agro.ledger.domain.MeasurementEntry;
import org.springframework.stereotype.Component;

@Component
public class EntryMapper {

  /** Дни интервала без замеров в ответ не попадают; править можно только текущую неделю и черновики. */
  public List<EntryDay> days(List<MeasurementEntry> entries, LocalDate from, LocalDate to) {
    LocalDate currentWeek = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    List<EntryDay> out = new ArrayList<>();
    for (MeasurementEntry e : entries) {
      EntryDay d = new EntryDay();
      d.setDate(e.getEntryDate());
      d.setPlotId(e.getPlotId());
      d.setStatus(e.getStatus().name());
      d.setEditable(!e.getEntryDate().isBefore(currentWeek)
          && (e.getStatus() == EntryStatus.DRAFT || e.getStatus() == EntryStatus.RETURNED));
      e.getValues().forEach(v -> {
        EntryValue ev = new EntryValue();
        ev.setCropId(v.getCrop().getId());
        ev.setValue(v.getValue());
        d.addValuesItem(ev);
      });
      out.add(d);
    }
    return out;
  }
}
