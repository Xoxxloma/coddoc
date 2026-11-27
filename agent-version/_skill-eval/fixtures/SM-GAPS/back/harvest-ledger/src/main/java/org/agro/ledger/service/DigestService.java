package org.agro.ledger.service;

import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Digest;
import org.agro.ledger.domain.EntryStatus;
import org.agro.ledger.repository.MeasurementEntryRepository;
import org.agro.ledger.repository.StationReadingRepository;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class DigestService {

  private final MeasurementEntryRepository entries;
  private final StationReadingRepository stations;

  /** Отправлено — дни на подтверждении и подтверждённые; просрочено — черновики; осадки — по метеостанциям сети. */
  public Digest weekly(LocalDate weekStart) {
    LocalDate to = weekStart.plusDays(6);
    Digest d = new Digest();
    d.setWeekStart(weekStart);
    d.setSubmitted((int) entries.countByEntryDateBetweenAndStatusIn(weekStart, to, List.of(EntryStatus.PENDING, EntryStatus.APPROVED)));
    d.setOverdue((int) entries.countByEntryDateBetweenAndStatusIn(weekStart, to, List.of(EntryStatus.DRAFT)));
    d.setPrecipitationMm(stations.totalPrecipitation(weekStart, to));
    return d;
  }
}
