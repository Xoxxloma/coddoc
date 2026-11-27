package org.agro.ledger.service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.api.model.EntrySave;
import org.agro.ledger.api.model.WeekStatus;
import org.agro.ledger.domain.*;
import org.agro.ledger.repository.CropRepository;
import org.agro.ledger.repository.MeasurementEntryRepository;
import org.agro.ledger.repository.PlotRepository;
import org.agro.ledger.repository.WeekWindowRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class EntryService {

  private final MeasurementEntryRepository entries;
  private final CropRepository crops;
  private final PlotRepository plots;
  private final WeekWindowRepository windows;
  private final AuditPublisher audit;

  public List<MeasurementEntry> list(String number, LocalDate from, LocalDate to) {
    return entries.findByAgronomistNumberAndEntryDateBetweenOrderByEntryDate(number, from, to);
  }

  /** Все дни — одной недели; прошедшая неделя правится только при открытом окне; участок — только свой и не в архиве. */
  @Transactional
  public void save(String number, List<EntrySave> days) {
    Set<LocalDate> weeks = days.stream().map(d -> weekStart(d.getDate())).collect(Collectors.toSet());
    if (weeks.size() > 1) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "days from different weeks");
    }
    LocalDate week = weeks.iterator().next();
    if (week.isBefore(weekStart(LocalDate.now())) && !windowOpen(number, week)) {
      throw new ResponseStatusException(HttpStatus.LOCKED, "week is closed");
    }
    for (EntrySave d : days) {
      if (d.getPlotId() != null) {
        Plot p = plots.findById(d.getPlotId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "plot"));
        if (!p.getOwnerNumber().equals(number) || p.isArchived()) {
          throw new ResponseStatusException(HttpStatus.FORBIDDEN, "not your plot");
        }
      }
      MeasurementEntry e = entries.findByAgronomistNumberAndEntryDate(number, d.getDate()).stream()
          .filter(x -> java.util.Objects.equals(x.getPlotId(), d.getPlotId())).findFirst()
          .orElseGet(MeasurementEntry::new);
      e.setAgronomistNumber(number);
      e.setEntryDate(d.getDate());
      e.setPlotId(d.getPlotId());
      e.setStatus(EntryStatus.DRAFT);
      e.setUpdatedAt(LocalDateTime.now());
      e.getValues().clear();
      d.getValues().forEach(v -> {
        EntryValue ev = new EntryValue();
        ev.setEntry(e);
        ev.setCrop(crops.getReferenceById(v.getCropId()));
        ev.setValue(v.getValue());
        e.getValues().add(ev);
      });
      entries.save(e);
    }
    audit.entriesSaved(number, number, days.size());
  }

  @Transactional
  public void submit(String number, LocalDate weekStart) {
    list(number, weekStart, weekStart.plusDays(6)).stream()
        .filter(e -> e.getStatus() == EntryStatus.DRAFT || e.getStatus() == EntryStatus.RETURNED)
        .forEach(e -> e.setStatus(EntryStatus.PENDING));
  }

  public WeekStatus weekStatus(String number, LocalDate weekStart) {
    Map<EntryStatus, Long> by = list(number, weekStart, weekStart.plusDays(6)).stream()
        .collect(Collectors.groupingBy(MeasurementEntry::getStatus, Collectors.counting()));
    WeekStatus s = new WeekStatus();
    s.setDraft(by.getOrDefault(EntryStatus.DRAFT, 0L).intValue());
    s.setPending(by.getOrDefault(EntryStatus.PENDING, 0L).intValue());
    s.setApproved(by.getOrDefault(EntryStatus.APPROVED, 0L).intValue());
    s.setReturned(by.getOrDefault(EntryStatus.RETURNED, 0L).intValue());
    s.setWindowOpen(windowOpen(number, weekStart));
    return s;
  }

  /** Только свой черновик; отправленный или подтверждённый день не удаляется. */
  @Transactional
  public void deleteDraftDay(String number, LocalDate date) {
    List<MeasurementEntry> day = entries.findByAgronomistNumberAndEntryDate(number, date);
    if (day.stream().anyMatch(e -> e.getStatus() != EntryStatus.DRAFT)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "day is not a draft");
    }
    entries.deleteAll(day);
  }

  @Transactional
  public void decide(String head, String agronomist, Decision decision) {
    if (!decision.getApprove() && (decision.getComment() == null || decision.getComment().isBlank())) {
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "comment required");
    }
    entries.findByStatusAndEntryDateBetween(EntryStatus.PENDING, LocalDate.now().minusYears(1), LocalDate.now()).stream()
        .filter(e -> e.getAgronomistNumber().equals(agronomist))
        .forEach(e -> {
          e.setStatus(decision.getApprove() ? EntryStatus.APPROVED : EntryStatus.RETURNED);
          e.setDecidedBy(head);
          e.setDecisionComment(decision.getComment());
        });
  }

  private boolean windowOpen(String number, LocalDate week) {
    return windows.findByAgronomistNumberAndWeekStart(number, week)
        .map(w -> w.getStatus() == WindowStatus.OPEN).orElse(false);
  }

  static LocalDate weekStart(LocalDate d) {
    return d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
  }
}
