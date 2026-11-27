package org.agro.ledger.service;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.CropTotal;
import org.agro.ledger.api.model.SummaryRow;
import org.agro.ledger.directory.RegionDirectoryDao;
import org.agro.ledger.domain.EntryStatus;
import org.agro.ledger.repository.MeasurementEntryRepository;
import org.agro.ledger.repository.PestCaseViewRepository;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SummaryService {

  private final RegionDirectoryDao directory;
  private final MeasurementEntryRepository entries;
  private final PestCaseViewRepository pestCases;

  /** Только подтверждённые замеры; пустой ids — все регионы (хозяйства). */
  public List<SummaryRow> summary(String level, List<Long> ids, String month) {
    YearMonth ym = YearMonth.parse(month);
    LocalDate from = ym.atDay(1);
    LocalDate to = ym.atEndOfMonth();
    List<RegionDirectoryDao.Unit> units = "region".equals(level) ? directory.regions() : directory.farms();
    List<SummaryRow> rows = new ArrayList<>();
    for (RegionDirectoryDao.Unit u : units) {
      if (ids != null && !ids.isEmpty() && !ids.contains(u.id())) {
        continue;
      }
      SummaryRow row = new SummaryRow();
      row.setId(u.id());
      row.setName(u.name());
      long closed = "region".equals(level)
          ? pestCases.countClosedInRegions(List.of(u.id()), from.atStartOfDay(), to.atTime(23, 59))
          : pestCases.countClosedOnFarms(List.of(u.id()), from.atStartOfDay(), to.atTime(23, 59));
      row.setPestCasesClosed((int) closed);
      entries.findByStatusAndEntryDateBetween(EntryStatus.APPROVED, from, to).forEach(e ->
          e.getValues().forEach(v -> row.putCropTotalsItem(v.getCrop().getCode(),
              row.getCropTotals() == null || row.getCropTotals().get(v.getCrop().getCode()) == null
                  ? v.getValue() : row.getCropTotals().get(v.getCrop().getCode()).add(v.getValue()))));
      rows.add(row);
    }
    return rows;
  }

  /** По культурам месяца; культуры без группы идут в группу «Прочее» в конце. */
  public List<CropTotal> byCrop(String month) {
    YearMonth ym = YearMonth.parse(month);
    Map<String, CropTotal> out = new LinkedHashMap<>();
    entries.findByStatusAndEntryDateBetween(EntryStatus.APPROVED, ym.atDay(1), ym.atEndOfMonth()).forEach(e ->
        e.getValues().forEach(v -> {
          CropTotal t = out.computeIfAbsent(v.getCrop().getCode(), c -> {
            CropTotal n = new CropTotal();
            n.setCropCode(c);
            n.setGroupName(v.getCrop().getGroup() == null ? "Прочее" : v.getCrop().getGroup().getName());
            n.setTotal(BigDecimal.ZERO);
            return n;
          });
          t.setTotal(t.getTotal().add(v.getValue()));
        }));
    return new ArrayList<>(out.values());
  }

  public List<RegionDirectoryDao.Unit> regions() {
    return directory.regions();
  }

  public List<RegionDirectoryDao.Unit> farms(Long regionId) {
    return regionId == null ? directory.farms() : directory.farmsOfRegion(regionId);
  }

  /** Таблица Excel: строка на регион (хозяйство), столбец на код культуры, последний — закрытые случаи вредителей. */
  public byte[] exportXlsx(String level, String month) {
    List<SummaryRow> rows = summary(level, List.of(), month);
    try (ByteArrayOutputStream os = new ByteArrayOutputStream()) {
      Workbook wb = new Workbook(os, "harvest-ledger", "1.0");
      Worksheet ws = wb.newWorksheet("Сводка " + month);
      ws.value(0, 0, "region".equals(level) ? "Регион" : "Хозяйство");
      int r = 1;
      for (SummaryRow row : rows) {
        ws.value(r, 0, row.getName());
        int c = 1;
        if (row.getCropTotals() != null) {
          for (Map.Entry<String, BigDecimal> e : row.getCropTotals().entrySet()) {
            ws.value(0, c, e.getKey());
            ws.value(r, c++, e.getValue());
          }
        }
        ws.value(r, c, row.getPestCasesClosed());
        r++;
      }
      wb.finish();
      return os.toByteArray();
    } catch (Exception e) {
      throw new IllegalStateException("xlsx failed", e);
    }
  }
}
